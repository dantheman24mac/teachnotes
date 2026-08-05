#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# -eq 2 ]] || { printf 'usage: setup.sh SHA BRANCH\n' >&2; exit 1; }
sha=$1; branch=$2
STAGING_RELEASE_ROOT=${STAGING_RELEASE_ROOT:-/home/dantheman/releases/teachnotes-staging}
STAGING_RELEASE_DIR="$STAGING_RELEASE_ROOT/$sha"; export STAGING_RELEASE_DIR TEACHNOTES_RELEASE_SHA=$sha
source "$STAGING_RELEASE_DIR/deploy/pi/staging/common.sh"
require_commands docker curl git openssl flock node
assert_staging_path "$STAGING_DATA_ROOT"; assert_staging_path "$STAGING_RELEASE_ROOT"
production_healthy || die "production must be healthy before staging setup"
production_before=$(production_fingerprint) || die "could not fingerprint production before staging setup"

available_kib=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( available_kib >= 6 * 1024 * 1024 )) || die "at least 6 GiB available RAM is required"
available_disk_kib=$(df -Pk /srv | awk 'NR==2 {print $4}')
(( available_disk_kib >= 40 * 1024 * 1024 )) || die "at least 40 GiB free disk is required"

exec 9>"$STAGING_RELEASE_ROOT/deploy.lock"; flock -n 9 || die "another staging operation is running"
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 750 "$STAGING_DATA_ROOT" "$STAGING_SECRET_DIR"
mkdir -p "$STAGING_RELEASE_ROOT"
[[ -f $STAGING_SECRET_DIR/cloudflare.env ]] || die "missing staging-only Cloudflare bootstrap secrets"
chmod 600 "$STAGING_SECRET_DIR/cloudflare.env"
source "$STAGING_SECRET_DIR/cloudflare.env"
[[ -n ${TUNNEL_TOKEN:-} && -n ${TURNSTILE_SITE_KEY:-} && -n ${TURNSTILE_SECRET_KEY:-} ]] || die "incomplete Cloudflare bootstrap secrets"

docker network inspect "$STAGING_NETWORK" >/dev/null 2>&1 || docker network create "$STAGING_NETWORK" >/dev/null

if [[ ! -f $STAGING_SUPABASE_DIR/docker-compose.yml ]]; then
  tmp=$(mktemp -d /tmp/teachnotes-staging-supabase.XXXXXX)
  trap 'rm -rf "$tmp"' EXIT
  git -C "$tmp" init -q
  git -C "$tmp" remote add origin https://github.com/supabase/supabase.git
  git -C "$tmp" fetch -q --depth 1 origin 244301c09ddba21aa963ebea09e712ce89b0401a
  git -C "$tmp" archive FETCH_HEAD docker | tar -x -C "$STAGING_DATA_ROOT"
  mv "$STAGING_DATA_ROOT/docker" "$STAGING_SUPABASE_DIR"
fi
[[ -f $STAGING_SUPABASE_DIR/.env ]] || cp "$STAGING_SUPABASE_DIR/.env.example" "$STAGING_SUPABASE_DIR/.env"
chmod 600 "$STAGING_SUPABASE_DIR/.env"

set_env() {
  local file=$1 key=$2 value=$3
  local tmp="${file}.tmp.$$"
  awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" {print key "=" value; done=1; next} {print} END{if(!done) print key "=" value}' "$file" > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$file"
}
random_hex() { openssl rand -hex "$1"; }

if ! grep -q '^TEACHNOTES_STAGING_INITIALIZED=true$' "$STAGING_SUPABASE_DIR/.env"; then
  (cd "$STAGING_SUPABASE_DIR" && sh utils/generate-keys.sh --update-env >/dev/null && sh utils/add-new-auth-keys.sh --update-env >/dev/null)
  set_env "$STAGING_SUPABASE_DIR/.env" POSTGRES_PASSWORD "$(random_hex 24)"
  set_env "$STAGING_SUPABASE_DIR/.env" DASHBOARD_USERNAME staging-admin
  set_env "$STAGING_SUPABASE_DIR/.env" DASHBOARD_PASSWORD "$(random_hex 24)"
  set_env "$STAGING_SUPABASE_DIR/.env" VAULT_ENC_KEY "$(random_hex 16)"
  set_env "$STAGING_SUPABASE_DIR/.env" PG_META_CRYPTO_KEY "$(random_hex 24)"
  set_env "$STAGING_SUPABASE_DIR/.env" SECRET_KEY_BASE "$(random_hex 48)"
  set_env "$STAGING_SUPABASE_DIR/.env" S3_PROTOCOL_ACCESS_KEY_ID "$(random_hex 16)"
  set_env "$STAGING_SUPABASE_DIR/.env" S3_PROTOCOL_ACCESS_KEY_SECRET "$(random_hex 32)"
  set_env "$STAGING_SUPABASE_DIR/.env" POOLER_TENANT_ID staging
  set_env "$STAGING_SUPABASE_DIR/.env" SUPABASE_PUBLIC_URL https://staging-api.teachnotes.fyi
  set_env "$STAGING_SUPABASE_DIR/.env" API_EXTERNAL_URL https://staging-api.teachnotes.fyi/auth/v1
  set_env "$STAGING_SUPABASE_DIR/.env" SITE_URL https://staging.teachnotes.fyi
  set_env "$STAGING_SUPABASE_DIR/.env" ADDITIONAL_REDIRECT_URLS https://staging.teachnotes.fyi/**
  set_env "$STAGING_SUPABASE_DIR/.env" DISABLE_SIGNUP true
  set_env "$STAGING_SUPABASE_DIR/.env" ENABLE_EMAIL_SIGNUP false
  set_env "$STAGING_SUPABASE_DIR/.env" ENABLE_EMAIL_AUTOCONFIRM true
  set_env "$STAGING_SUPABASE_DIR/.env" ENABLE_PHONE_SIGNUP false
  set_env "$STAGING_SUPABASE_DIR/.env" ENABLE_PHONE_AUTOCONFIRM false
  set_env "$STAGING_SUPABASE_DIR/.env" SMTP_ADMIN_EMAIL no-reply@staging.teachnotes.test
  set_env "$STAGING_SUPABASE_DIR/.env" SMTP_HOST localhost.invalid
  set_env "$STAGING_SUPABASE_DIR/.env" SMTP_PORT 2525
  set_env "$STAGING_SUPABASE_DIR/.env" SMTP_USER disabled
  set_env "$STAGING_SUPABASE_DIR/.env" SMTP_PASS "$(random_hex 16)"
  set_env "$STAGING_SUPABASE_DIR/.env" TURNSTILE_SECRET_KEY "$TURNSTILE_SECRET_KEY"
  set_env "$STAGING_SUPABASE_DIR/.env" TEACHNOTES_STAGING_INITIALIZED true
fi

publishable=$(awk -F= '$1=="SUPABASE_PUBLISHABLE_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$STAGING_SUPABASE_DIR/.env")
secret_key=$(awk -F= '$1=="SUPABASE_SECRET_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$STAGING_SUPABASE_DIR/.env")
[[ -n $publishable && -n $secret_key ]] || die "Supabase key generation failed"

if [[ ! -f $STAGING_SECRET_DIR/app.env ]]; then
  admin_password=$(random_hex 16); tutor_password=$(random_hex 16); action_key=$(openssl rand -base64 32 | tr -d '\n')
  atomic_write "$STAGING_SECRET_DIR/app.env" "NEXT_PUBLIC_APP_URL=https://staging.teachnotes.fyi
NEXT_PUBLIC_SUPABASE_URL=https://staging-api.teachnotes.fyi
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$publishable
SUPABASE_INTERNAL_URL=http://kong:8000
SUPABASE_SECRET_KEY=$secret_key
TEACHNOTES_ENVIRONMENT=staging
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$action_key
NEXT_PUBLIC_TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
STAGING_ADMIN_EMAIL=admin@staging.teachnotes.test
STAGING_ADMIN_PASSWORD=$admin_password
STAGING_TUTOR_EMAIL=tutor@staging.teachnotes.test
STAGING_TUTOR_PASSWORD=$tutor_password"
fi
atomic_write "$STAGING_SECRET_DIR/tunnel.env" "TUNNEL_TOKEN=$TUNNEL_TOKEN"
assert_staging_text "$(<"$STAGING_SECRET_DIR/app.env")"

printf 'Starting the independent staging Supabase project...\n'
supabase_compose up -d
for _ in $(seq 1 60); do docker exec teachnotes-staging-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 3; done
docker exec teachnotes-staging-db pg_isready -U postgres >/dev/null || die "staging database failed health"

rm -f "$STAGING_RELEASE_ROOT/approval"
flock -u 9; exec 9>&-
bash "$STAGING_RELEASE_DIR/deploy/pi/staging/deploy-release.sh" "$sha" "$branch"
app_compose run --rm --no-deps web node scripts/seed-staging.mjs
bash "$STAGING_RELEASE_DIR/deploy/pi/staging/verify.sh"
production_after=$(production_fingerprint) || die "could not fingerprint production after staging setup"
[[ $production_before == "$production_after" ]] || die "production data changed during staging setup"
printf 'Staging provisioning completed without restarting production services.\n'
