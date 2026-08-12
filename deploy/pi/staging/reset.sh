#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${1:-} == --confirm-destroy-staging && $# -eq 1 ]] || { printf 'usage: reset.sh --confirm-destroy-staging\n' >&2; exit 1; }
STAGING_RELEASE_ROOT=${STAGING_RELEASE_ROOT:-/home/dantheman/releases/teachnotes-staging}
sha=$(<"$STAGING_RELEASE_ROOT/current-sha"); STAGING_RELEASE_DIR="$STAGING_RELEASE_ROOT/$sha"; export STAGING_RELEASE_DIR TEACHNOTES_RELEASE_SHA=$sha
source "$STAGING_RELEASE_DIR/deploy/pi/staging/common.sh"
assert_staging_path "$STAGING_SUPABASE_DIR/volumes/db/data"; assert_staging_path "$STAGING_SUPABASE_DIR/volumes/storage"
production_healthy || die "production must be healthy before staging reset"
production_before=$(production_fingerprint) || die "could not fingerprint production before staging reset"
exec 9>"$STAGING_RELEASE_ROOT/deploy.lock"; flock -n 9 || die "another staging operation is running"
stamp=$(date -u +%Y%m%dT%H%M%SZ); archive="$STAGING_DATA_ROOT/reset-archives/$stamp"; assert_staging_path "$archive"
mkdir -p "$archive"; rm -f "$STAGING_RELEASE_ROOT/approval"

recover_previous_staging() {
  local status=$?
  trap - ERR
  if [[ -d $archive/db-data || -d $archive/storage ]]; then
    printf 'Reset failed after archival; restoring the previous staging data...\n' >&2
    app_compose down >/dev/null 2>&1 || true
    supabase_compose down >/dev/null 2>&1 || true
    if [[ -d $archive/db-data ]]; then
      sudo rm -rf -- "$STAGING_SUPABASE_DIR/volumes/db/data"
      sudo mv "$archive/db-data" "$STAGING_SUPABASE_DIR/volumes/db/data"
    fi
    if [[ -d $archive/storage ]]; then
      sudo rm -rf -- "$STAGING_SUPABASE_DIR/volumes/storage"
      sudo mv "$archive/storage" "$STAGING_SUPABASE_DIR/volumes/storage"
    fi
    supabase_compose up -d || true
    app_compose up -d web cloudflared || true
  fi
  exit "$status"
}
trap recover_previous_staging ERR

app_compose down
supabase_compose down
[[ -d $STAGING_SUPABASE_DIR/volumes/db/data ]] && sudo mv "$STAGING_SUPABASE_DIR/volumes/db/data" "$archive/db-data"
[[ -d $STAGING_SUPABASE_DIR/volumes/storage ]] && sudo mv "$STAGING_SUPABASE_DIR/volumes/storage" "$archive/storage"
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 750 "$STAGING_SUPABASE_DIR/volumes/db/data" "$STAGING_SUPABASE_DIR/volumes/storage"
supabase_compose up -d
for _ in $(seq 1 60); do docker exec teachnotes-staging-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 3; done
docker exec teachnotes-staging-db pg_isready -U postgres >/dev/null 2>&1 || { printf 'error: reset database failed health\n' >&2; false; }
db_password=$(awk -F= '$1=="POSTGRES_PASSWORD" {sub(/^[^=]*=/, ""); print; exit}' "$STAGING_SUPABASE_DIR/.env")
db_url="postgresql://postgres:${db_password}@127.0.0.1:15433/postgres?sslmode=disable"
migrations_applied=false
for _ in $(seq 1 12); do
  if run_pinned_supabase /home/dantheman/code/teachnotes/node_modules/.bin/supabase db push --db-url "$db_url" --workdir "$STAGING_RELEASE_DIR"; then
    migrations_applied=true
    break
  fi
  sleep 5
done
[[ $migrations_applied == true ]] || { printf 'error: staging reset migration apply failed\n' >&2; false; }
app_compose up -d web cloudflared
app_compose run --rm --no-deps web node scripts/seed-staging.mjs
bash "$STAGING_RELEASE_DIR/deploy/pi/staging/verify.sh"
production_after=$(production_fingerprint) || { printf 'error: could not fingerprint production after staging reset\n' >&2; false; }
[[ $production_before == "$production_after" ]] || { printf 'error: production data changed during staging reset\n' >&2; false; }
trap - ERR
sudo find "$STAGING_DATA_ROOT/reset-archives" -mindepth 1 -maxdepth 1 -type d ! -name "$stamp" -exec rm -rf -- {} +
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ); atomic_write "$STAGING_RELEASE_ROOT/current-deployment" "SHA=$sha
DEPLOYED_AT=$deployed_at"
printf 'Staging reset passed health. Recovery archive retained at %s.\n' "$archive"
