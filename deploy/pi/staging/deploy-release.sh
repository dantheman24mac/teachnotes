#!/usr/bin/env bash
set -Eeuo pipefail

[[ $# -eq 2 ]] || { printf 'usage: deploy-release.sh SHA BRANCH\n' >&2; exit 1; }
sha=$1
branch=$2
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { printf 'error: invalid SHA\n' >&2; exit 1; }
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || { printf 'error: invalid branch\n' >&2; exit 1; }

repo=${TEACHNOTES_REPO:-/home/dantheman/code/teachnotes}
STAGING_RELEASE_ROOT=${STAGING_RELEASE_ROOT:-/home/dantheman/releases/teachnotes-staging}
STAGING_RELEASE_DIR="$STAGING_RELEASE_ROOT/$sha"
export STAGING_RELEASE_DIR TEACHNOTES_RELEASE_SHA=$sha
# shellcheck source=deploy/pi/staging/common.sh
source "$STAGING_RELEASE_DIR/deploy/pi/staging/common.sh"

require_commands git docker curl flock node
assert_staging_path "$STAGING_RELEASE_ROOT"
assert_staging_path "$STAGING_SECRET_DIR"
assert_staging_path "$STAGING_SUPABASE_DIR"
production_healthy || die "production must be healthy before a staging release"
production_before=$(production_fingerprint) || die "could not fingerprint production before staging release"
[[ -f $STAGING_SECRET_DIR/app.env && -f $STAGING_SECRET_DIR/tunnel.env ]] || die "staging secrets are missing"
[[ -f $STAGING_SUPABASE_DIR/.env && -f $STAGING_SUPABASE_DIR/docker-compose.yml ]] || die "staging Supabase is not provisioned"
assert_staging_text "$(<"$STAGING_SECRET_DIR/app.env")"

exec 9>"$STAGING_RELEASE_ROOT/deploy.lock"
flock -n 9 || die "another staging operation is running"

remote_sha=$(git -C "$repo" rev-parse "refs/remotes/origin/${branch}^{commit}")
[[ $remote_sha == "$sha" ]] || die "origin/$branch does not resolve to the requested SHA"

approval_file="$STAGING_RELEASE_ROOT/approval"
current_sha_file="$STAGING_RELEASE_ROOT/current-sha"
deployment_file="$STAGING_RELEASE_ROOT/current-deployment"
previous_sha=
if [[ -f $current_sha_file ]]; then previous_sha=$(<"$current_sha_file"); fi
rm -f "$approval_file"

db_password=$(awk -F= '$1=="POSTGRES_PASSWORD" {sub(/^[^=]*=/, ""); print; exit}' "$STAGING_SUPABASE_DIR/.env")
[[ -n $db_password && $db_password =~ ^[A-Za-z0-9]+$ ]] || die "staging database password is missing or unsafe"
db_url="postgresql://postgres:${db_password}@127.0.0.1:15433/postgres?sslmode=disable"
supabase_cli="$repo/node_modules/.bin/supabase"
[[ -x $supabase_cli ]] || die "repository-pinned Supabase CLI is unavailable"

printf 'Dry-running staging migrations for %s...\n' "$sha"
run_pinned_supabase "$supabase_cli" db push --dry-run --db-url "$db_url" --workdir "$STAGING_RELEASE_DIR" || die "staging migration dry run failed"
printf 'Applying pending migrations only to staging...\n'
run_pinned_supabase "$supabase_cli" db push --db-url "$db_url" --workdir "$STAGING_RELEASE_DIR" || die "staging migration apply failed"
run_pinned_supabase "$supabase_cli" migration list --db-url "$db_url" --workdir "$STAGING_RELEASE_DIR" >/dev/null || die "staging migration history verification failed"

printf 'Building isolated staging web image...\n'
app_compose build web
old_image=$(docker inspect --format '{{.Image}}' teachnotes-staging-web 2>/dev/null || true)
if [[ -n $old_image && $previous_sha =~ ^[0-9a-f]{40}$ ]]; then docker tag "$old_image" "teachnotes-staging-web:rollback-${previous_sha:0:12}"; fi

rollback() {
  printf 'error: staging release failed: %s\n' "$1" >&2
  if [[ -n $old_image ]]; then
    docker tag "$old_image" teachnotes-staging-web:latest
    app_compose up -d --no-deps --force-recreate --no-build web || true
  fi
  app_compose logs --tail=80 web >&2 || true
  exit 1
}

app_compose up -d --no-deps web || rollback "container replacement failed"
healthy=false
for _ in $(seq 1 40); do
  body=$(docker exec teachnotes-staging-web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null || true)
  if grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body" &&
     grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$body"; then healthy=true; break; fi
  sleep 3
done
[[ $healthy == true ]] || rollback "internal health did not report the requested staging SHA"

app_compose up -d --no-deps cloudflared
public_body=$(curl -fsS --retry 8 --retry-delay 3 "$STAGING_HEALTH_URL") || rollback "public staging health failed"
grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$public_body" || rollback "public environment mismatch"
grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$public_body" || rollback "public SHA mismatch"

deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
production_after=$(production_fingerprint) || die "could not fingerprint production after staging release"
[[ $production_before == "$production_after" ]] || die "production data changed during the staging release; current staging marker was not updated"
atomic_write "$current_sha_file" "$sha"
atomic_write "$deployment_file" "SHA=$sha
DEPLOYED_AT=$deployed_at"
printf 'Staging is healthy at %s (%s). Approval is now invalid until explicitly renewed.\n' "$sha" "$deployed_at"
