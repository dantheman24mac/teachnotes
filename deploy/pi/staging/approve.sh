#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# -eq 1 && $1 =~ ^[0-9a-f]{40}$ ]] || { printf 'usage: approve.sh SHA\n' >&2; exit 1; }
sha=$1
STAGING_RELEASE_ROOT=${STAGING_RELEASE_ROOT:-/home/dantheman/releases/teachnotes-staging}
STAGING_RELEASE_DIR="$STAGING_RELEASE_ROOT/$sha"
export STAGING_RELEASE_DIR
source "$STAGING_RELEASE_DIR/deploy/pi/staging/common.sh"
require_commands curl flock
exec 9>"$STAGING_RELEASE_ROOT/deploy.lock"; flock -n 9 || die "another staging operation is running"
[[ $(<"$STAGING_RELEASE_ROOT/current-sha") == "$sha" ]] || die "requested SHA is not current staging"
source "$STAGING_RELEASE_ROOT/current-deployment"
[[ ${SHA:-} == "$sha" && ${DEPLOYED_AT:-} =~ ^[0-9]{4}- ]] || die "invalid staging deployment record"
body=$(curl -fsS --retry 3 "$STAGING_HEALTH_URL") || die "staging public health failed"
grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body" || die "staging environment mismatch"
grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$body" || die "staging health SHA mismatch"
approved_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [[ ! $approved_at > $DEPLOYED_AT ]]; then sleep 1; approved_at=$(date -u +%Y-%m-%dT%H:%M:%SZ); fi
atomic_write "$STAGING_RELEASE_ROOT/approval" "SHA=$sha
DEPLOYED_AT=$DEPLOYED_AT
APPROVED_AT=$approved_at
HEALTH_SHA=$sha"
printf 'Approved healthy staging SHA %s at %s.\n' "$sha" "$approved_at"
