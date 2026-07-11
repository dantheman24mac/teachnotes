# Raspberry Pi production deployment

This deployment keeps TeachNotes, PostgreSQL, Auth, REST and invoice Storage on one ARM64 Raspberry Pi. Cloudflare Tunnel is the only public ingress; no router ports or database ports are opened.

## Topology

- `app.<domain>` routes through Cloudflare Tunnel to `http://web:3000`.
- `api.<domain>` routes through Cloudflare Tunnel to `http://kong:8000`.
- `web` uses `http://kong:8000` internally to avoid a public network round trip.
- PostgreSQL and invoice files persist under `/srv/teachnotes/supabase/volumes`.
- Studio, PostgreSQL and all container ports remain private.

## Prerequisites

- 64-bit Raspberry Pi OS or Debian on ARM64.
- Docker Engine and the current Docker Compose plugin (`docker compose`, not legacy `docker-compose`).
- A Cloudflare-managed DNS zone and two unused hostnames.
- A production SMTP provider is not required for username/password login.

The official Supabase stack recommends at least 4 GB RAM and an SSD. Use the official self-hosting setup rather than `supabase start`, which is development-only.

## One-time host setup

1. Create the private shared network:

   ```bash
   docker network create teachnotes
   ```

2. Install the official Supabase self-hosted Docker project into `/srv/teachnotes/supabase` by following <https://supabase.com/docs/guides/self-hosting/docker>. Generate fresh production secrets; never reuse the local CLI defaults.

3. Set these Supabase URLs in its private `.env`:

   ```dotenv
   SUPABASE_PUBLIC_URL=https://api.<domain>
   API_EXTERNAL_URL=https://api.<domain>/auth/v1
   SITE_URL=https://app.<domain>
   DISABLE_SIGNUP=true
   ENABLE_EMAIL_SIGNUP=false
   ```

4. Attach Kong to the shared network whenever the Supabase stack is started:

   ```bash
   cd /srv/teachnotes/supabase
   docker compose -f docker-compose.yml \
     -f /home/dantheman/code/teachnotes/deploy/pi/supabase-network.override.yaml \
     up -d
   ```

5. Copy `app.env.example` to `app.env` and `tunnel.env.example` to `tunnel.env`. Set both files to mode `600`. The Cloudflare token belongs only in `tunnel.env`.

6. Apply TeachNotes migrations to the running PostgreSQL service. Never use `db reset` against production.

7. Create the one owner account with `npm run auth:create-owner`. Supply the Supabase secret key only to this one-off command; it is not needed by the running web container.

8. Build and start the app and tunnel:

   ```bash
   cd /home/dantheman/code/teachnotes/deploy/pi
   docker compose --env-file app.env --env-file tunnel.env \
     -f compose.app.yaml up -d --build
   ```

## Updates

Pull a reviewed commit, take a backup, apply forward-only migrations, then rebuild the web container. Supabase image versions should be updated as a tested release set rather than independently.

## Local-only backups

`backup.sh` creates a timestamped PostgreSQL custom-format dump, archives invoice Storage and writes checksums. Backups are not deleted automatically:

```bash
sudo install -d -m 700 -o dantheman -g dantheman /srv/teachnotes/backups
/home/dantheman/code/teachnotes/deploy/pi/backup.sh
```

Schedule it with a systemd timer or cron only after running it once and testing a restore. These backups remain vulnerable to loss of the Pi or its disk; moving one encrypted copy off-device is a later hardening step.
