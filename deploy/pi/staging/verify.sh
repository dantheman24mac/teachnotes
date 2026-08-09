#!/usr/bin/env bash
set -Eeuo pipefail
STAGING_RELEASE_ROOT=${STAGING_RELEASE_ROOT:-/home/dantheman/releases/teachnotes-staging}
sha=$(<"$STAGING_RELEASE_ROOT/current-sha")
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { printf 'error: invalid current staging SHA\n' >&2; exit 1; }
STAGING_RELEASE_DIR="$STAGING_RELEASE_ROOT/$sha"; export STAGING_RELEASE_DIR TEACHNOTES_RELEASE_SHA=$sha
source "$STAGING_RELEASE_DIR/deploy/pi/staging/common.sh"
require_commands docker curl
production_healthy || die "production is unhealthy"

declare -a actual_containers=()
for project in "$STAGING_APP_PROJECT" "$STAGING_SUPABASE_PROJECT"; do
  while IFS= read -r container; do
    [[ -n $container ]] && actual_containers+=("$container")
  done < <(docker ps -a \
    --filter "label=com.docker.compose.project=$project" \
    --format '{{.Names}}')
done
[[ ${#actual_containers[@]} -eq 13 ]] || die "expected exactly 13 staging project containers, found ${#actual_containers[@]}"

require_compose_service() {
  local project=$1 service=$2 id name state health
  local -a ids=()
  mapfile -t ids < <(docker ps -aq \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service")
  [[ ${#ids[@]} -eq 1 ]] || die "expected exactly one $project/$service container, found ${#ids[@]}"
  id=${ids[0]}
  name=$(docker inspect --format '{{.Name}}' "$id"); name=${name#/}
  state=$(docker inspect --format '{{.State.Status}}' "$id")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
  [[ $state == running ]] || die "$name is not running ($state)"
  if [[ $service == cloudflared ]]; then
    [[ $health == none || $health == healthy ]] || die "$name is not healthy ($health)"
  else
    [[ $health == healthy ]] || die "$name does not have a passing healthcheck ($health)"
  fi
}

for service in web cloudflared; do
  require_compose_service "$STAGING_APP_PROJECT" "$service"
done
for service in studio kong auth rest realtime storage imgproxy meta functions db supavisor; do
  require_compose_service "$STAGING_SUPABASE_PROJECT" "$service"
done
for container in "${actual_containers[@]}"; do
  while IFS= read -r network; do
    case "$network" in
      teachnotes|teachnotes-demo|supabase_default) die "$container joined production network $network" ;;
    esac
  done < <(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$container")
  while IFS= read -r source; do
    [[ $source != /srv/teachnotes/supabase/volumes* ]] || die "$container mounts production Supabase data"
    [[ $source != /var/lib/docker/volumes/supabase_* ]] || die "$container mounts a production Supabase named volume"
  done < <(docker inspect --format '{{range .Mounts}}{{.Source}}{{println}}{{end}}' "$container")
done

web_env=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' teachnotes-staging-web)
assert_staging_text "$web_env"
grep -q '^TEACHNOTES_ENVIRONMENT=staging$' <<<"$web_env" || die "staging web identity is missing"

internal=$(docker exec teachnotes-staging-web wget -qO- http://127.0.0.1:3000/api/health)
public=$(curl -fsS --retry 3 "$STAGING_HEALTH_URL")
for body in "$internal" "$public"; do
  grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body" || die "health environment mismatch"
  grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$body" || die "health SHA mismatch"
done

for route in auth/v1/health rest/v1/ storage/v1/status; do
  route_status=$(curl -sS -o /dev/null -w '%{http_code}' "https://staging-api.teachnotes.fyi/$route")
  [[ $route_status =~ ^[1-4][0-9][0-9]$ && $route_status != 404 ]] || die "public API route failed: $route returned $route_status"
done
status=$(curl -sS -o /dev/null -w '%{http_code}' https://staging-api.teachnotes.fyi/this-must-not-exist)
[[ $status == 404 ]] || die "unmatched staging API route returned $status"
signup_status=$(curl -sS -o /tmp/teachnotes-staging-signup.$$ -w '%{http_code}' -H "apikey: $(awk -F= '$1=="NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$STAGING_SECRET_DIR/app.env")" -H 'content-type: application/json' --data '{"email":"blocked-signup@staging.teachnotes.test","password":"ThisMustNeverCreate123!"}' https://staging-api.teachnotes.fyi/auth/v1/signup)
rm -f /tmp/teachnotes-staging-signup.$$
[[ $signup_status =~ ^4 ]] || die "public signup was not rejected"

service_key=$(awk -F= '$1=="SUPABASE_SECRET_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$STAGING_SECRET_DIR/app.env")
curl -fsS -o /dev/null -H "apikey: $service_key" -H "Authorization: Bearer $service_key" "http://127.0.0.1:18000/rest/v1/students?select=id&limit=1" || die "authenticated staging REST workflow failed"
docker exec teachnotes-staging-db pg_isready -U postgres >/dev/null || die "staging database is not ready"
printf 'Verified staging isolation, routes, identity, signup denial, authenticated REST, and SHA %s.\n' "$sha"
