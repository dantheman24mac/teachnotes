#!/usr/bin/env bash
set -Eeuo pipefail

INCIDENT_DIR=${TEACHNOTES_INCIDENT_DIR:-/srv/teachnotes/incidents}
DIAGNOSE_BIN=${TEACHNOTES_DIAGNOSE_BIN:-/usr/local/sbin/teachnotes-diagnose}
PROC_ROOT=${TEACHNOTES_PROC_ROOT:-/proc}

install -d -m 0700 "$INCIDENT_DIR"

if [[ -r $PROC_ROOT/sys/kernel/random/boot_id ]]; then
  boot_id=$(tr -d '\n' < "$PROC_ROOT/sys/kernel/random/boot_id")
else
  boot_id=unknown
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
report="$INCIDENT_DIR/boot-$stamp-${boot_id:0:12}.txt"
tmp_report=$(mktemp "$INCIDENT_DIR/.boot-report.XXXXXX")
trap 'rm -f "$tmp_report"' EXIT

previous_boot_exists=false
if journalctl --list-boots --no-pager | awk '$1 == "-1" {found=1} END {exit !found}'; then
  previous_boot_exists=true
fi

{
  printf '# Raspberry Pi boot incident report\n'
  printf 'Generated: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'Current boot ID: %s\n' "$boot_id"
  printf 'Clock synchronized: %s\n' "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || printf unknown)"
  printf 'Current boot started: %s\n' "$(uptime -s 2>/dev/null || printf unknown)"

  if [[ $previous_boot_exists == true ]]; then
    if journalctl -b -1 --no-pager -n 200 |
      grep -Eq 'System Power Off|Reached target poweroff.target|Journal stopped'; then
      printf 'Previous boot classification: clean shutdown\n'
    else
      printf 'Previous boot classification: unclean or incomplete shutdown evidence\n'
    fi
    printf '\n'
    "$DIAGNOSE_BIN" --boot -1
  else
    printf 'Previous boot classification: unavailable; no earlier persistent journal exists\n'
    printf '\n'
    "$DIAGNOSE_BIN" --since '24 hours ago'
  fi
} > "$tmp_report"

chmod 0600 "$tmp_report"
mv "$tmp_report" "$report"
trap - EXIT
printf '%s\n' "$report"
