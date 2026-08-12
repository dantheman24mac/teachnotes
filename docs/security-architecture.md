# Security architecture

## Trust boundaries

Internet traffic terminates at Cloudflare and reaches the Raspberry Pi through an outbound-only Cloudflare Tunnel. The Pi does not publish the Next.js, PostgreSQL, Supavisor or Kong ports to the Internet. The browser-facing Supabase hostname is routed through the same Tunnel because Supabase Auth and PostgREST are browser protocols.

Authentication alone does not grant access. A signed-in account must be approved, must not be awaiting a password replacement and must satisfy PostgreSQL Row Level Security for every user-owned table and private storage object.

The service-role credential is used only by server-side administrator operations. The Tunnel token, Turnstile secret, Supabase secret key and Server Action encryption key remain in mode-`600` Pi files and are excluded from Git.

## Browser controls

The application emits HSTS, MIME sniffing protection, frame denial, a restrictive referrer policy and a restrictive Permissions Policy. A per-request nonce-based Content Security Policy allows the application runtime and Cloudflare Turnstile while denying plugins, unexpected frames and arbitrary connection destinations.

Authenticated application responses and APIs are private and non-cacheable. The service worker caches only versioned static assets and a user-neutral offline shell. Offline lesson data is stored in an IndexedDB database namespaced by user ID and cleared during sign-out.

Finalized spreadsheet invoices are generated only from owner-scoped database snapshots. Their Excel and converted PDF files share the existing private Storage boundary and owner-folder policies; temporary conversion files use isolated per-run directories and are deleted after LibreOffice exits.

## Demo isolation

`demo.teachnotes.fyi` is built from the production source commit but runs as a separate container. It receives no production environment file, Supabase URL, publishable key, service-role key or Tunnel token. It is attached only to the `teachnotes-demo` Docker network. The Cloudflare connector is the sole container attached to both the production and demo networks.

All demo identities, addresses, notes, invoice values and account details are fictional. Demo mutations never reach PostgreSQL or production storage.

## Operational controls

- GitHub Actions validates lint, TypeScript, unit tests and the production build.
- CodeQL, Dependabot, GitGuardian and GitHub secret scanning monitor the public repository.
- Production releases build an exact pushed commit in a detached Pi worktree while the previous container stays online.
- The deployment keeps a rollback image and requires internal health before replacement is accepted.
- PostgreSQL and private invoice storage are backed up before migration releases.
