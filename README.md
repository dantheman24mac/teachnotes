# TeachNotes

TeachNotes is an offline-friendly lesson, attendance, student and invoice manager for an independent tutor. It uses Next.js 16, TypeScript, Supabase and Docker, with a standalone image suitable for a future Railway deployment.

## What is included

- Magic-link authentication with server-side session cookies.
- Today agenda with quick attendance and note capture.
- IndexedDB lesson cache, offline outbox, idempotent sync and visible conflict resolution.
- Student-specific fixed duration/price defaults and future-lesson updates.
- Weekly and fortnightly recurring series, multiple weekdays, exclusions, open-ended rolling materialization and one/following/all-future rescheduling.
- Consolidated and per-student monthly invoice previews, immutable invoice snapshots, private PDFs, void-and-regenerate behavior and double-billing protection.
- Row Level Security on every user-owned database table and private invoice storage.
- Responsive desktop/mobile UI, installable web manifest, service-worker shell cache, unit tests and browser workflow tests.

## Start locally

Prerequisites: Node.js 22+, npm and Docker Desktop.

```bash
npm install
npm run dev:up
```

The first run downloads the official Supabase images, applies the migrations, creates `.env.local`, builds the web container and opens these services:

- App: <http://localhost:3000>
- Captured magic-link email: <http://localhost:54324>
- Supabase API: <http://localhost:54321>

Enter an email on the sign-in screen, then open Mailpit to follow the local magic link. Stop everything with:

```bash
npm run dev:down
```

For fast UI work without authentication or a running backend, stop Supabase, remove `.env.local`, and run `npm run dev`; TeachNotes will use representative demo data.

## Development commands

```bash
npm run dev          # Next.js development server
npm run build        # production standalone build
npm run lint         # ESLint
npm test             # pricing and recurrence unit tests
npm run test:e2e     # desktop/mobile browser workflows
npm run db:reset     # rebuild local database from migrations
npm run env:local    # refresh .env.local from Supabase status
```

## Architecture notes

- Server Components query Supabase directly; browser HTTP endpoints are reserved for delta sync, paginated history and private PDF downloads.
- Authenticated pages and API responses are private and uncached. Static assets use Next.js immutable caching.
- The service worker caches successful navigation shells, while IndexedDB is the authoritative device-side cache for active students, lessons, drafts and queued edits.
- Lesson changes carry an operation UUID and base version. The PostgreSQL sync function locks each row, deduplicates retries and returns a conflict instead of overwriting another edit.
- Money is stored in integer cents and each lesson snapshots a fixed amount. Duration changes never prorate the amount automatically.
- A partial unique database index prevents one lesson from appearing in two active finalized invoices.

## Railway later

The root `Dockerfile` produces a non-root Next.js standalone server with `/api/health`. On Railway, deploy the app from this Dockerfile, set the environment variables from a managed Supabase project, and use `SUPABASE_INTERNAL_URL` only when Railway can reach Supabase at a different private address than the browser-facing URL.
