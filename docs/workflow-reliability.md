# Workflow reliability handoff

This release changes lesson totals, student history, offline sync, recurring rescheduling, and invoice finalization. It also adds three forward migrations. Apply all three migrations in order before deploying app code that calls their database functions:

1. `202609070001_lesson_field_lww.sql`
2. `202609080001_recurring_reschedule.sql`
3. `202609090001_invoice_transactions.sql`

Use the production migration procedure in [Commit and Raspberry Pi release pipeline](commit-and-pi-release.md). Back up the production database first, apply the migrations without `db reset`, verify database and authentication behavior, then deploy with the migration review flag after CI passes. No deployment is part of this change.

## Changed behavior

The Today page now counts every billable lesson in the current workspace month in its earnings and billable lesson totals, including lessons that already belong to an invoice. Invoice previews remain limited to uninvoiced billable lessons, so a finalized lesson contributes to reporting without appearing on a second invoice.

Student profiles fetch upcoming lessons separately from past notes. The history shows only past lessons with notes, newest first, and loads older notes in stable pages. Its cursor uses both the full database timestamp and lesson UUID, so lessons with the same start time are neither repeated nor skipped.

Offline lesson edits now resolve independently for notes, attendance status, and billing override. For each field, the save with the later client timestamp wins. If timestamps match, the lexically greater operation UUID wins. Retries remain idempotent. Existing device queues and stored conflicts are migrated or retried automatically when that user's offline store opens. The database keeps a four-argument `apply_lesson_operation` overload for older clients; those calls use server arrival time until the client refreshes to code that sends its save time.

This ordering depends on the client clock. A badly incorrect clock can make an edit appear newer or older than it really is. The client keeps locally generated save times increasing on one device, but it cannot correct a clock difference between devices.

Changing a recurring lesson with "This and following" or "All future" now creates a replacement series and retires the old series in one database transaction. Actual past lessons and completed or invoiced lessons stay attached to the retired series and do not move. Scheduled future lessons that had been moved as one-offs follow the replacement series. Existing lesson IDs, notes, and amounts are retained when an occurrence can be mapped.

The replacement keeps the original explicit end date and exclusions. Weekly and fortnightly schedules preserve their local wall-clock time. A local time that does not exist during a daylight-saving transition is skipped. If moving an existing lesson would put it at the same start time as an unrelated lesson for that student, the transaction rolls back instead of leaving a partly changed series. "This lesson only" remains a single occurrence update and does not retire the series.

Invoice finalization now allocates the number, stores invoice and line snapshots, and claims eligible lessons in one database transaction. Concurrent or failed finalization cannot leave a partial invoice or consume a number. Voiding an invoice releases its lessons and lines in one transaction so they can be invoiced again. Missing tutor and billing details now remain blank instead of using fictional defaults.

Excel and PDF generation happens after the invoice transaction. An artifact failure does not undo the finalized invoice. The invoice page exposes a separate retry for missing artifacts, using the stored invoice snapshot rather than current settings.

## Validation and release checks

Run the checks against the exact integration commit:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
sh scripts/test-database.sh
DEMO_MODE=true TEACHNOTES_ENVIRONMENT=demo npx playwright test tests/e2e/demo-workflow.spec.ts
```

The database script starts an isolated PostgreSQL container and supplies minimal Auth and Storage fixtures. It validates migrations and database functions, but it is not a complete Supabase end-to-end environment. The demo Playwright workflow exercises the credential-free synthetic-data app.

Run the authenticated Supabase browser suite and the invoice artifact browser test in a configured disposable environment before release. They require Supabase Auth, Storage, and document conversion services and were not run as part of this cleanup pass. Follow the existing CI, clean-worktree, backup, migration review, health-check, and explicit production confirmation gates in the release pipeline document. The developer merges the integration branch to `main` and performs deployment.
