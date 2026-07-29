# Raspberry Pi production deployment

This deployment keeps TeachNotes, PostgreSQL, Auth, REST and invoice Storage on one ARM64 Raspberry Pi. Cloudflare Tunnel is the only public ingress; no router ports or database ports are opened.

## Topology

- `teachnotes.fyi` routes through Cloudflare Tunnel to `http://web:3000`.
- `api.teachnotes.fyi` routes only `/auth/v1`, `/rest/v1` and `/storage/v1`
  through Cloudflare Tunnel to `http://kong:8000`; every other API-host path
  returns `404` at the connector.
- `demo.teachnotes.fyi` routes to `http://demo:3000`. The demo container has no
  production environment file or Supabase credentials and is isolated on the
  `teachnotes-demo` Docker network.
- `web` uses `http://kong:8000` internally to avoid a public network round trip.
- PostgreSQL and invoice files persist under `/srv/teachnotes/supabase/volumes`.
- PostgreSQL, Supavisor and Kong bind only to loopback. Supabase Studio and
  gateway administration paths are not included in Tunnel ingress.

## Prerequisites

- 64-bit Raspberry Pi OS or Debian on ARM64.
- Docker Engine and the current Docker Compose plugin (`docker compose`, not legacy `docker-compose`).
- A Cloudflare-managed DNS zone and two unused hostnames.
- A production SMTP provider is not required. Signup is auto-confirmed, so email
  addresses are account identifiers rather than proof that the user controls the
  mailbox. Approval and password-reset credentials are communicated outside
  TeachNotes.

The official Supabase stack recommends at least 4 GB RAM and an SSD. Use the official self-hosting setup rather than `supabase start`, which is development-only.

## One-time host setup

1. Create the private shared network:

   ```bash
   docker network create teachnotes
   docker network create teachnotes-demo
   ```

2. Install the official Supabase self-hosted Docker project into `/srv/teachnotes/supabase` by following <https://supabase.com/docs/guides/self-hosting/docker>. Generate fresh production secrets; never reuse the local CLI defaults.

3. Initially keep signup disabled while applying the account migration. Set
   these values in the Supabase project's private `.env`:

   ```dotenv
   SUPABASE_PUBLIC_URL=https://api.teachnotes.fyi
   API_EXTERNAL_URL=https://api.teachnotes.fyi/auth/v1
   SITE_URL=https://teachnotes.fyi
   DISABLE_SIGNUP=true
   ENABLE_EMAIL_SIGNUP=false
   ENABLE_EMAIL_AUTOCONFIRM=true
   TURNSTILE_SECRET_KEY=<cloudflare-turnstile-secret-key>
   ```

   `TURNSTILE_SECRET_KEY` is consumed only by the `auth` service through
   `supabase-network.override.yaml`. Never put it in the web app environment.

4. Attach Kong to the shared network whenever the Supabase stack is started:

   ```bash
   cd /srv/teachnotes/supabase
   docker compose -f docker-compose.yml \
     -f /home/dantheman/code/teachnotes/deploy/pi/supabase-network.override.yaml \
     -f /home/dantheman/code/teachnotes/deploy/pi/supabase-logging.override.yaml \
     up -d
   ```

5. Copy `app.env.example` to `app.env` and `tunnel.env.example` to `tunnel.env`.
   Set both files to mode `600`. The Cloudflare token belongs only in
   `tunnel.env`. The Turnstile site key is public and belongs in `app.env`; the
   Turnstile secret belongs only in the Supabase `.env`. The Supabase secret key
   in `app.env` is runtime-only and is required for administrator-assisted
   password replacement; never use it as a Docker build argument or a
   `NEXT_PUBLIC_*` value.

6. Back up PostgreSQL, then apply TeachNotes migrations to the running service.
   Never use `db reset` against production. The account migration backfills
   existing Auth users as approved so the current owner is not locked out.

7. Run `npm run auth:create-owner`. The command finds or creates the configured
   email, preserves existing tutor data, and promotes that account to the sole
   protected administrator. It is safe to rerun. If that administrator later
   loses the password, use `npm run auth:reset-owner` from a trusted terminal.

8. Build and start the app and tunnel:

   ```bash
   cd /home/dantheman/code/teachnotes/deploy/pi
   docker compose --env-file app.env --env-file tunnel.env \
     -f compose.app.yaml up -d --build
   ```

   The normal production release rebuilds only `web`. Deploy the credential-free
   demo independently with `scripts/deploy-demo-pi.sh`; the script builds the
   exact pushed commit, starts only `demo`, and attaches the already-running
   Cloudflare connector to `teachnotes-demo` without restarting it.

9. Sign in as the owner and verify the administrator dashboard. Create a test
   signup and confirm it can read only its own pending account, not students,
   lessons, invoices, sync RPCs, or invoice Storage. Approve it and verify its
   empty workspace is isolated from the owner's data.

10. Only after those checks, enable public email signup in the Supabase `.env`:

    ```dotenv
    DISABLE_SIGNUP=false
    ENABLE_EMAIL_SIGNUP=true
    ENABLE_EMAIL_AUTOCONFIRM=true
    ```

    Restart the self-hosted `auth` service with the base Compose file and
    `supabase-network.override.yaml`, then repeat the signup smoke test through
    the public hostname. Keep the Turnstile override active on every Auth
    restart.

## Updates

Pull a reviewed commit, take a backup, apply forward-only migrations, then rebuild the web container. Supabase image versions should be updated as a tested release set rather than independently.

Always include both `supabase-network.override.yaml` and
`supabase-logging.override.yaml` when starting or updating the production
Supabase stack. The logging override bounds each service at five 10 MB JSON log
files.

## Outage logging and monitoring

The Pi uses a five-minute systemd monitor, persistent bounded journals, boot
incident reports and independent UptimeRobot checks. See
[Raspberry Pi outage logging and monitoring](../../docs/pi-observability.md)
for installation, private heartbeat configuration, Discord alerts and the
diagnosis matrix.

## Cloudflare ingress

Keep the remotely managed Tunnel rules in this order:

1. `teachnotes.fyi` → `http://web:3000`
2. `api.teachnotes.fyi` with path `^/auth/v1(?:/.*)?$` → `http://kong:8000`
3. `api.teachnotes.fyi` with path `^/rest/v1(?:/.*)?$` → `http://kong:8000`
4. `api.teachnotes.fyi` with path `^/storage/v1(?:/.*)?$` → `http://kong:8000`
5. `api.teachnotes.fyi` → `http_status:404`
6. `demo.teachnotes.fyi` → `http://demo:3000`
7. catch-all → `http_status:404`

The demo DNS record is a proxied CNAME to the same Tunnel UUID. The demo
container still has no access to the `teachnotes` production Docker network.

## Local-only backups

`backup.sh` creates a timestamped PostgreSQL custom-format dump, archives invoice Storage and writes checksums. Backups are not deleted automatically:

```bash
sudo install -d -m 700 -o dantheman -g dantheman /srv/teachnotes/backups
/home/dantheman/code/teachnotes/deploy/pi/backup.sh
```

Schedule it with a systemd timer or cron only after running it once and testing a restore. These backups remain vulnerable to loss of the Pi or its disk; moving one encrypted copy off-device is a later hardening step.
