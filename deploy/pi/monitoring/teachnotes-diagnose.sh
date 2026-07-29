#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  teachnotes-diagnose [--since "YYYY-MM-DD HH:MM:SS" | --boot BOOT]

Without arguments, reports the current boot and the last 24 hours.
BOOT may be a journal boot offset such as -1 or a boot ID.
EOF
}

mode=since
value='24 hours ago'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      mode=since
      value=$2
      shift 2
      ;;
    --boot)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      mode=boot
      value=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ $mode == since ]]; then
  journal_args=(--since "$value")
else
  [[ $value =~ ^-?[0-9]+$ || $value =~ ^[0-9a-f]{32}$ ]] || {
    printf 'error: invalid boot identifier\n' >&2
    exit 2
  }
  journal_args=(-b "$value")
fi

heading() {
  printf '\n## %s\n' "$1"
}

printf '# TeachNotes Raspberry Pi diagnostic\n'
printf 'Generated: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'Scope: %s=%s\n' "$mode" "$value"

heading 'Host and boot history'
hostnamectl
uptime
last -x -n 20
journalctl --list-boots --no-pager

heading 'Failed systemd units'
systemctl --failed --no-pager || true

heading 'Access path'
systemctl status ssh tailscaled --no-pager || true
tailscale status --peers=false || true
ip route show || true

heading 'Docker and TeachNotes stack'
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}' || true
for container_name in \
  teachnotes-web-1 teachnotes-demo-1 teachnotes-cloudflared \
  supabase-auth supabase-edge-functions supabase-storage supabase-rest \
  supabase-meta supabase-kong realtime-dev.supabase-realtime \
  supabase-pooler supabase-imgproxy supabase-db supabase-studio; do
  docker inspect \
    --format '{{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restart={{.RestartCount}} oom={{.State.OOMKilled}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' \
    "$container_name" 2>/dev/null || printf '%s missing\n' "$container_name"
done

heading 'Public endpoints'
curl --fail --silent --show-error --max-time 10 https://teachnotes.fyi/api/health || true
printf '\n'
curl --head --silent --show-error --max-time 10 https://teachnotes.fyi/login | head -n 12 || true

heading 'Shutdown, login, power, kernel, network, and service evidence'
journalctl "${journal_args[@]}" --no-pager -o short-iso-precise |
  grep -Ei \
    'accepted publickey|sudo.*command=|shutdown|poweroff|powering down|reboot|journal stopped|under.?voltage|throttl|thermal|oom|out of memory|i/o error|ext4|mmc|watchdog|tailscale|networkmanager|docker|cloudflared|teachnotes' |
  tail -n 500 || true

heading 'End of selected journal'
journalctl "${journal_args[@]}" --no-pager -n 160 || true
