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
git -C "$repo" worktree list --porcelain | grep -Fxq "worktree $STAGING_RELEASE_DIR" || die "candidate release path is not a registered worktree"
[[ $(git -C "$STAGING_RELEASE_DIR" rev-parse HEAD) == "$sha" ]] || die "candidate release worktree SHA mismatch"
[[ -z $(git -C "$STAGING_RELEASE_DIR" status --porcelain --untracked-files=all) ]] || die "candidate release worktree is not clean"
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
previous_release_dir=
previous_deployment=
if [[ -f $current_sha_file ]]; then
  previous_sha=$(<"$current_sha_file")
  [[ $previous_sha =~ ^[0-9a-f]{40}$ ]] || die "current staging SHA is invalid"
  previous_release_dir="$STAGING_RELEASE_ROOT/$previous_sha"
  [[ -d $previous_release_dir && -f $previous_release_dir/deploy/pi/staging/compose.app.yaml ]] ||
    die "retained previous staging release is unavailable"
  git -C "$repo" worktree list --porcelain | grep -Fxq "worktree $previous_release_dir" ||
    die "retained previous staging release is not a registered worktree"
  [[ $(git -C "$previous_release_dir" rev-parse HEAD) == "$previous_sha" ]] ||
    die "retained previous staging release SHA mismatch"
  [[ -z $(git -C "$previous_release_dir" status --porcelain --untracked-files=all) ]] ||
    die "retained previous staging release is not clean"
fi
if [[ -f $deployment_file ]]; then previous_deployment=$(<"$deployment_file"); fi
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

printf 'Reconciling isolated staging Realtime configuration...\n'
supabase_compose up -d --no-deps realtime || die "staging Realtime reconciliation failed"
realtime_healthy=false
for _ in $(seq 1 40); do
  realtime_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' realtime-staging.supabase-realtime 2>/dev/null || true)
  if [[ $realtime_health == healthy ]]; then realtime_healthy=true; break; fi
  sleep 3
done
[[ $realtime_healthy == true ]] || die "staging Realtime did not become healthy"

printf 'Building isolated staging web image...\n'
app_compose build web
old_image=$(docker inspect --format '{{.Image}}' teachnotes-staging-web 2>/dev/null || true)
if [[ -n $previous_sha ]]; then
  [[ -n $old_image ]] || die "current staging web image is unavailable for rollback"
  docker tag "$old_image" "teachnotes-staging-web:rollback-${previous_sha:0:12}"
fi

rollback() {
  local reason=$1 rollback_release_dir internal_restored tunnel_restored public_restored body
  printf 'error: staging release failed: %s\n' "$reason" >&2
  rollback_release_dir=$previous_release_dir
  if [[ -n $old_image && $previous_sha =~ ^[0-9a-f]{40}$ && -d $rollback_release_dir ]]; then
    STAGING_RELEASE_DIR=$rollback_release_dir
    TEACHNOTES_RELEASE_SHA=$previous_sha
    export STAGING_RELEASE_DIR TEACHNOTES_RELEASE_SHA
    docker tag "$old_image" teachnotes-staging-web:latest
    if app_compose up -d --no-deps --force-recreate --no-build web; then
      internal_restored=false
      for _ in $(seq 1 40); do
        body=$(docker exec teachnotes-staging-web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null || true)
        if grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body" &&
           grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$previous_sha\"" <<<"$body"; then
          internal_restored=true
          break
        fi
        sleep 3
      done
      tunnel_restored=false
      if [[ $internal_restored == true ]] && app_compose up -d --no-deps cloudflared; then
        tunnel_restored=true
      fi
      public_restored=false
      if [[ $internal_restored == true && $tunnel_restored == true ]]; then
        for _ in $(seq 1 20); do
          body=$(curl -fsS "$STAGING_HEALTH_URL" 2>/dev/null || true)
          if grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body" &&
             grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$previous_sha\"" <<<"$body"; then
            public_restored=true
            break
          fi
          sleep 3
        done
      fi
      if [[ $internal_restored == true && $tunnel_restored == true && $public_restored == true ]]; then
        printf 'Restored verified staging release %s.\n' "$previous_sha" >&2
      else
        printf 'error: previous staging release could not be health-verified after rollback\n' >&2
      fi
    else
      printf 'error: previous staging web container could not be recreated\n' >&2
    fi
  else
    printf 'error: no retained previous staging release is available for verified rollback\n' >&2
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

app_compose up -d --no-deps cloudflared || rollback "Cloudflare tunnel reconciliation failed"
public_healthy=false
for _ in $(seq 1 20); do
  public_body=$(curl -fsS "$STAGING_HEALTH_URL" 2>/dev/null || true)
  if grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$public_body" &&
     grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$public_body"; then
    public_healthy=true
    break
  fi
  sleep 3
done
[[ $public_healthy == true ]] || rollback "public staging health did not report the requested environment and SHA"

deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
production_after=$(production_fingerprint) || rollback "could not fingerprint production after staging release"
[[ $production_before == "$production_after" ]] || rollback "production data changed during the staging release"
if ! atomic_write "$deployment_file" "SHA=$sha
DEPLOYED_AT=$deployed_at"; then
  rollback "staging deployment record could not be updated"
fi
if ! atomic_write "$current_sha_file" "$sha"; then
  if [[ -n $previous_deployment ]]; then
    atomic_write "$deployment_file" "$previous_deployment" || true
  else
    rm -f "$deployment_file"
  fi
  rollback "current staging SHA marker could not be updated"
fi
printf 'Staging is healthy at %s (%s). Approval is now invalid until explicitly renewed.\n' "$sha" "$deployed_at"
