#!/usr/bin/env bash
set -Eeuo pipefail
sha=${1:-$(git rev-parse HEAD)}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { printf 'error: invalid SHA\n' >&2; exit 1; }
ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman "bash /home/dantheman/releases/teachnotes-staging/$sha/deploy/pi/staging/approve.sh $sha"
