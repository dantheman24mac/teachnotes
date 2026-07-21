# Contributing to TeachNotes

Thank you for helping improve TeachNotes.

## Development setup

Use Node.js 22+, npm and Docker Desktop, then follow the local setup in [README.md](README.md). The application deliberately falls back to synthetic demo data when local Supabase is not configured.

## Pull requests

1. Create a focused branch from `main`.
2. Keep production credentials, `.env` files, database dumps and real tutor or student data out of Git.
3. Add or update tests for behavioral changes.
4. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
5. Explain the user impact, implementation and validation in the pull request.

Do not combine schema migrations with unrelated UI work. Production migrations must be forward-only and reviewed with a tested backup and restore procedure.

## Security reports

Follow [SECURITY.md](SECURITY.md). Never disclose a vulnerability or secret in a public issue.
