#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${1:-} == --confirm-destroy-staging ]] || { printf 'usage: reset-staging-pi.sh --confirm-destroy-staging\n' >&2; exit 1; }
ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman 'sha=$(cat /home/dantheman/releases/teachnotes-staging/current-sha) && bash "/home/dantheman/releases/teachnotes-staging/$sha/deploy/pi/staging/reset.sh" --confirm-destroy-staging'
