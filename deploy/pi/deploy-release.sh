#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ $# -ge 2 ]] || die "usage: deploy-release.sh SHA BRANCH [--migration-diff-reviewed]"
sha=$1
branch=$2
shift 2

migration_diff_reviewed=false
if [[ ${1:-} == "--migration-diff-reviewed" ]]; then
  migration_diff_reviewed=true
  shift
fi
[[ $# -eq 0 ]] || die "unexpected release arguments"

[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "invalid release SHA"
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || die "invalid release branch"
[[ $branch == main ]] || die "production releases are restricted to main"
export TEACHNOTES_RELEASE_SHA=$sha

repo=${TEACHNOTES_REPO:-/home/dantheman/code/teachnotes}
release_root=${TEACHNOTES_RELEASE_ROOT:-/home/dantheman/releases/teachnotes}
secret_dir=${TEACHNOTES_SECRET_DIR:-$repo/deploy/pi}
[[ $release_root != *teachnotes-staging* && $secret_dir != *teachnotes-staging* ]] || die "staging release or secret path rejected by production deployment"
release_dir="$release_root/$sha"
current_sha_file="$release_root/current-sha"

for command_name in git docker curl flock; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done
[[ -d $repo/.git ]] || die "repository not found at $repo"
[[ -f $secret_dir/app.env ]] || die "missing $secret_dir/app.env"
[[ -f $secret_dir/tunnel.env ]] || die "missing $secret_dir/tunnel.env"

mkdir -p "$release_root"
exec 9>"$release_root/deploy.lock"
flock -n 9 || die "another TeachNotes deployment is already running"

remote_sha=$(git -C "$repo" rev-parse "refs/remotes/origin/${branch}^{commit}")
[[ $remote_sha == "$sha" ]] || die "origin/$branch does not resolve to $sha on the Pi"
main_sha=$(git -C "$repo" rev-parse 'refs/remotes/origin/main^{commit}')
[[ $main_sha == "$sha" ]] || die "production SHA is not the exact origin/main tip"

staging_root=/home/dantheman/releases/teachnotes-staging
[[ -f $staging_root/current-sha && $(<"$staging_root/current-sha") == "$sha" ]] || die "staging current SHA does not match production candidate"
[[ -f $staging_root/current-deployment && -f $staging_root/approval ]] || die "staging approval is missing"
unset SHA DEPLOYED_AT APPROVED_AT HEALTH_SHA
source "$staging_root/current-deployment"
staging_deployed_at=$DEPLOYED_AT
unset SHA DEPLOYED_AT APPROVED_AT HEALTH_SHA
source "$staging_root/approval"
[[ $SHA == "$sha" && $HEALTH_SHA == "$sha" ]] || die "staging approval SHA mismatch"
[[ $DEPLOYED_AT == "$staging_deployed_at" && $APPROVED_AT > "$DEPLOYED_AT" ]] || die "staging approval is stale"
staging_health=$(curl -fsS --retry 3 https://staging.teachnotes.fyi/api/health) || die "staging public health failed"
grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$staging_health" || die "staging public environment mismatch"
grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$staging_health" || die "staging public SHA mismatch"

if [[ -s $current_sha_file ]]; then
  previous_sha=$(<"$current_sha_file")
else
  previous_sha=$(git -C "$repo" rev-parse HEAD)
fi
[[ $previous_sha =~ ^[0-9a-f]{40}$ ]] || die "invalid previous release marker"

if [[ $previous_sha != "$sha" ]]; then
  migration_changes=$(git -C "$repo" diff --name-only "$previous_sha" "$sha" -- supabase/migrations)
  if [[ -n $migration_changes && $migration_diff_reviewed != true ]]; then
    printf 'Database migration changes detected:\n%s\n' "$migration_changes" >&2
    die "back up production, apply and verify the forward migration, then rerun with --migration-diff-reviewed"
  fi
fi

if [[ -e $release_dir ]]; then
  [[ -d $release_dir/.git || -f $release_dir/.git ]] || die "$release_dir exists but is not a Git worktree"
  release_sha=$(git -C "$release_dir" rev-parse HEAD)
  [[ $release_sha == "$sha" ]] || die "existing release directory contains $release_sha"
  [[ -z $(git -C "$release_dir" status --porcelain --untracked-files=no) ]] || die "existing release worktree has tracked changes"
else
  git -C "$repo" worktree add --quiet --detach "$release_dir" "$sha"
fi

link_secret() {
  local name=$1
  local source_path="$secret_dir/$name"
  local target_path="$release_dir/deploy/pi/$name"

  if [[ -L $target_path ]]; then
    [[ $(readlink "$target_path") == "$source_path" ]] || die "$target_path points to an unexpected secret file"
  elif [[ -e $target_path ]]; then
    die "$target_path exists and is not the managed secret symlink"
  else
    ln -s "$source_path" "$target_path"
  fi
}

link_secret app.env
link_secret tunnel.env

secret_text=$(<"$secret_dir/app.env")
[[ $secret_text != *staging.teachnotes.fyi* && $secret_text != *staging-api.teachnotes.fyi* ]] || die "staging URL rejected by production deployment"
[[ $secret_text != *teachnotes-staging* ]] || die "staging network or path rejected by production deployment"

compose=(
  docker compose
  --env-file "$secret_dir/app.env"
  --env-file "$secret_dir/tunnel.env"
  -f "$release_dir/deploy/pi/compose.app.yaml"
)

printf 'Release:  %s\n' "$sha"
printf 'Branch:   %s\n' "$branch"
printf 'Previous: %s\n' "$previous_sha"
printf 'Building the exact release worktree while the current web container stays online...\n'
"${compose[@]}" build web

old_image=$(docker inspect --format '{{.Image}}' teachnotes-web-1 2>/dev/null || true)
rollback_tag="teachnotes-web:rollback-${previous_sha:0:12}"
if [[ -n $old_image ]]; then
  docker tag "$old_image" "$rollback_tag"
fi

rollback() {
  local reason=$1
  printf 'Release failed internal health: %s\n' "$reason" >&2
  if [[ -n $old_image ]]; then
    printf 'Restoring previous web image %s...\n' "$old_image" >&2
    docker tag "$old_image" teachnotes-web:latest
    "${compose[@]}" up -d --no-deps --force-recreate --no-build web
  else
    printf 'No previous web image was available for automatic rollback.\n' >&2
  fi
  "${compose[@]}" logs --tail=60 web >&2 || true
  exit 1
}

printf 'Replacing only the web service...\n'
"${compose[@]}" up -d --no-deps web || rollback "docker compose up failed"

healthy=false
health_body=''
for _ in $(seq 1 30); do
  container_id=$("${compose[@]}" ps -q web)
  if [[ -n $container_id ]]; then
    health_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
    if [[ $health_status == "healthy" ]]; then
      health_body=$("${compose[@]}" exec -T web wget -qO- http://127.0.0.1:3000/api/health) || true
      if grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$health_body" &&
        grep -Eq '"service"[[:space:]]*:[[:space:]]*"teachnotes"' <<<"$health_body" &&
        grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$health_body"; then
        healthy=true
        break
      fi
    fi
  fi
  sleep 3
done

[[ $healthy == true ]] || rollback "the new container did not become healthy"

marker_tmp="$release_root/.current-sha.$sha.tmp"
printf '%s\n' "$sha" > "$marker_tmp"
mv "$marker_tmp" "$current_sha_file"

printf 'Internal health: %s\n' "$health_body"
"${compose[@]}" ps web
"${compose[@]}" logs --tail=40 web

printf 'Checking Cloudflare-facing endpoints...\n'
public_health=$(curl -fsS --retry 3 --retry-delay 2 https://teachnotes.fyi/api/health) || {
  die "the release is internally healthy, but the public health endpoint failed"
}
grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$public_health" || {
  die "the public health endpoint returned an unexpected response"
}
grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$public_health" || {
  die "the public health endpoint returned a different release SHA"
}
curl -fsS --retry 3 --retry-delay 2 -o /dev/null https://teachnotes.fyi/login || {
  die "the release is internally healthy, but the public login page failed"
}

printf 'Public health: %s\n' "$public_health"
printf 'DEPLOYED_SHA=%s\n' "$sha"
printf 'ROLLBACK_IMAGE=%s\n' "${rollback_tag:-none}"
