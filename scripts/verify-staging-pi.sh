#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman 'sha=$(cat /home/dantheman/releases/teachnotes-staging/current-sha) && bash "/home/dantheman/releases/teachnotes-staging/$sha/deploy/pi/staging/verify.sh"'
