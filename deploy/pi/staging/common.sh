#!/usr/bin/env bash
set -Eeuo pipefail

STAGING_DATA_ROOT=${STAGING_DATA_ROOT:-/srv/teachnotes-staging}
STAGING_RELEASE_ROOT=${STAGING_RELEASE_ROOT:-/home/dantheman/releases/teachnotes-staging}
STAGING_SECRET_DIR=${STAGING_SECRET_DIR:-$STAGING_DATA_ROOT/secrets}
STAGING_SUPABASE_DIR=${STAGING_SUPABASE_DIR:-$STAGING_DATA_ROOT/supabase}
STAGING_NETWORK=teachnotes-staging
STAGING_SUPABASE_PROJECT=teachnotes-staging-supabase
STAGING_APP_PROJECT=teachnotes-staging
PRODUCTION_HEALTH_URL=https://teachnotes.fyi/api/health
STAGING_HEALTH_URL=https://staging.teachnotes.fyi/api/health

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

assert_staging_path() {
  local value=$1
  [[ $value == /srv/teachnotes-staging || $value == /srv/teachnotes-staging/* ||
     $value == /home/dantheman/releases/teachnotes-staging || $value == /home/dantheman/releases/teachnotes-staging/* ]] ||
    die "path is outside the staging roots: $value"
  [[ $value != /srv/teachnotes/supabase/volumes* ]] || die "production volume path rejected"
  [[ $value != /home/dantheman/releases/teachnotes/* ]] || die "production release root rejected"
}

assert_staging_text() {
  local value=$1
  [[ $value != *"https://teachnotes.fyi"* ]] || die "production application URL rejected"
  [[ $value != *"https://api.teachnotes.fyi"* ]] || die "production API URL rejected"
  [[ $value != *"supabase_default"* && $value != *"teachnotes-demo"* ]] || die "production network rejected"
  [[ $value != *"/srv/teachnotes/supabase/volumes"* ]] || die "production volume rejected"
  [[ $value != *"/home/dantheman/releases/teachnotes/"* ]] || die "production release root rejected"
}

require_commands() {
  local command_name
  for command_name in "$@"; do command -v "$command_name" >/dev/null 2>&1 || die "missing command: $command_name"; done
}

production_healthy() {
  local body
  body=$(curl -fsS --retry 3 --retry-delay 2 "$PRODUCTION_HEALTH_URL") || return 1
  grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$body" &&
    grep -Eq '"mode"[[:space:]]*:[[:space:]]*"production"' <<<"$body" &&
    ! grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body"
}

production_fingerprint() {
  docker exec supabase-db psql -U postgres -d postgres -Atqc \
    "select concat_ws('|',
      (select count(*) from auth.users),
      (select count(*) from public.accounts),
      (select count(*) from public.students),
      (select coalesce(max(sync_revision),0) from public.students),
      (select count(*) from public.lessons),
      (select coalesce(max(sync_revision),0) from public.lessons),
      (select count(*) from public.invoices),
      (select coalesce(max(version),'') from supabase_migrations.schema_migrations));" |
    sha256sum | awk '{print $1}'
}

atomic_write() {
  local path=$1 value=$2 tmp
  tmp="${path}.tmp.$$"
  printf '%s\n' "$value" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$path"
}

supabase_compose() {
  docker compose --env-file "$STAGING_SUPABASE_DIR/.env" \
    -f "$STAGING_SUPABASE_DIR/docker-compose.yml" \
    -f "$STAGING_RELEASE_DIR/deploy/pi/staging/supabase.override.yaml" "$@"
}

app_compose() {
  STAGING_SECRET_DIR=$STAGING_SECRET_DIR docker compose \
    --env-file "$STAGING_SECRET_DIR/app.env" \
    --env-file "$STAGING_SECRET_DIR/tunnel.env" \
    -f "$STAGING_RELEASE_DIR/deploy/pi/staging/compose.app.yaml" "$@"
}
