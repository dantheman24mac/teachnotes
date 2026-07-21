#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 2 ]] || die "usage: deploy-demo-release.sh SHA BRANCH"
sha=$1
branch=$2
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "invalid release SHA"
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || die "invalid release branch"

repo=${TEACHNOTES_REPO:-/home/dantheman/code/teachnotes}
release_root=${TEACHNOTES_RELEASE_ROOT:-/home/dantheman/releases/teachnotes}
secret_dir=${TEACHNOTES_SECRET_DIR:-$repo/deploy/pi}
release_dir="$release_root/$sha"

for command_name in git docker flock; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done
[[ -d $repo/.git ]] || die "repository not found at $repo"
[[ -f $secret_dir/app.env ]] || die "missing $secret_dir/app.env"
[[ -f $secret_dir/tunnel.env ]] || die "missing $secret_dir/tunnel.env"

mkdir -p "$release_root"
exec 9>"$release_root/deploy-demo.lock"
flock -n 9 || die "another TeachNotes demo deployment is already running"

remote_sha=$(git -C "$repo" rev-parse "refs/remotes/origin/${branch}^{commit}")
[[ $remote_sha == "$sha" ]] || die "origin/$branch does not resolve to $sha on the Pi"

if [[ -e $release_dir ]]; then
  [[ -d $release_dir/.git || -f $release_dir/.git ]] || die "$release_dir is not a Git worktree"
  [[ $(git -C "$release_dir" rev-parse HEAD) == "$sha" ]] || die "release worktree contains another revision"
  [[ -z $(git -C "$release_dir" status --porcelain --untracked-files=no) ]] || die "release worktree has tracked changes"
else
  git -C "$repo" worktree add --quiet --detach "$release_dir" "$sha"
fi

for name in app.env tunnel.env; do
  source_path="$secret_dir/$name"
  target_path="$release_dir/deploy/pi/$name"
  if [[ -L $target_path ]]; then
    [[ $(readlink "$target_path") == "$source_path" ]] || die "$target_path points to an unexpected file"
  elif [[ -e $target_path ]]; then
    die "$target_path exists and is not a managed secret symlink"
  else
    ln -s "$source_path" "$target_path"
  fi
done

docker network inspect teachnotes-demo >/dev/null 2>&1 || docker network create teachnotes-demo >/dev/null

compose=(
  docker compose
  --env-file "$secret_dir/app.env"
  --env-file "$secret_dir/tunnel.env"
  -f "$release_dir/deploy/pi/compose.app.yaml"
)

printf 'Building the isolated synthetic-data demo from %s...\n' "$sha"
"${compose[@]}" build demo
"${compose[@]}" up -d --no-deps demo

if [[ $(docker inspect --format '{{.State.Running}}' teachnotes-cloudflared 2>/dev/null || true) == "true" ]]; then
  cloudflared_id=$(docker inspect --format '{{.Id}}' teachnotes-cloudflared)
else
  cloudflared_id=$(docker ps --filter label=com.docker.compose.project=teachnotes --filter label=com.docker.compose.service=cloudflared --format '{{.ID}}' | head -n 1)
fi
[[ -n $cloudflared_id ]] || die "the TeachNotes Cloudflare connector is not running"
if ! docker inspect "$cloudflared_id" --format '{{json .NetworkSettings.Networks}}' | grep -q 'teachnotes-demo'; then
  docker network connect teachnotes-demo "$cloudflared_id"
fi

healthy=false
health_body=''
for _ in $(seq 1 30); do
  container_id=$("${compose[@]}" ps -q demo)
  if [[ -n $container_id ]]; then
    health_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
    if [[ $health_status == "healthy" ]]; then
      health_body=$("${compose[@]}" exec -T demo wget -qO- http://127.0.0.1:3000/api/health) || true
      if grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$health_body" &&
        grep -Eq '"mode"[[:space:]]*:[[:space:]]*"demo"' <<<"$health_body"; then
        healthy=true
        break
      fi
    fi
  fi
  sleep 3
done

[[ $healthy == true ]] || {
  "${compose[@]}" logs --tail=60 demo >&2 || true
  die "the demo container did not become healthy"
}

printf 'Demo health: %s\n' "$health_body"
"${compose[@]}" ps demo
printf 'DEMO_DEPLOYED_SHA=%s\n' "$sha"
