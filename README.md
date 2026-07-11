# TeachNotes

TeachNotes is an offline-friendly lesson, attendance, student and invoice manager for an independent tutor. It uses Next.js 16, TypeScript, Supabase and Docker. The production target is a Raspberry Pi behind Cloudflare Tunnel.

## What is included

- Private username/password authentication with server-side Supabase sessions.
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
npm run supabase:start
npm run env:local
npm run auth:create-owner
npm run dev
```

The setup commands download the local Supabase images, apply migrations and create `.env.local`. The owner command prompts for a password without storing it in the environment file. Local defaults use username `tutor` and the private backing email `tutor@teachnotes.local`.

The development services are:

- App: <http://localhost:3000>
- Supabase API: <http://localhost:54321>

After the owner exists, `npm run dev:up` can start the complete containerized development environment. Stop everything with:

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
npm run auth:create-owner # create the configured owner with a prompted password
```

## Architecture notes

- Server Components query Supabase directly; browser HTTP endpoints are reserved for delta sync, paginated history and private PDF downloads.
- Authenticated pages and API responses are private and uncached. Static assets use Next.js immutable caching.
- The service worker caches successful navigation shells, while IndexedDB is the authoritative device-side cache for active students, lessons, drafts and queued edits.
- Lesson changes carry an operation UUID and base version. The PostgreSQL sync function locks each row, deduplicates retries and returns a conflict instead of overwriting another edit.
- Money is stored in integer cents and each lesson snapshots a fixed amount. Duration changes never prorate the amount automatically.
- A partial unique database index prevents one lesson from appearing in two active finalized invoices.

## Raspberry Pi production

The root `Dockerfile` produces a non-root ARM64-compatible Next.js standalone server with `/api/health`. The Pi deployment runs the official self-hosted Supabase Docker stack and joins its Kong gateway to a private `teachnotes` Docker network. Cloudflare Tunnel publishes only the Next.js app and Supabase API hostnames; no inbound router or database ports are opened.

See [deploy/pi/README.md](deploy/pi/README.md) for the topology, environment templates, startup sequence and local backup procedure. Railway remains a compatible later option because the web container is stateless and continues to use standard Supabase URLs.
