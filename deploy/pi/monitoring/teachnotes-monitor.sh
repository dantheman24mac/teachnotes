#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

LOG_DIR=${TEACHNOTES_MONITOR_LOG_DIR:-/var/log/teachnotes-monitor}
STATE_DIR=${TEACHNOTES_MONITOR_STATE_DIR:-/var/lib/teachnotes-monitor}
LOG_FILE=${TEACHNOTES_MONITOR_LOG_FILE:-$LOG_DIR/status.jsonl}
PROC_ROOT=${TEACHNOTES_PROC_ROOT:-/proc}
SYS_ROOT=${TEACHNOTES_SYS_ROOT:-/sys}

CURL_BIN=${CURL_BIN:-curl}
DOCKER_BIN=${DOCKER_BIN:-docker}
FLOCK_BIN=${FLOCK_BIN:-flock}
IP_BIN=${IP_BIN:-ip}
LOGGER_BIN=${LOGGER_BIN:-logger}
PYTHON_BIN=${PYTHON_BIN:-python3}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}
TAILSCALE_BIN=${TAILSCALE_BIN:-tailscale}
VCGENCMD_BIN=${VCGENCMD_BIN:-vcgencmd}

PUBLIC_WEB_HEALTH_URL=${PUBLIC_WEB_HEALTH_URL:-https://teachnotes.fyi/api/health}

required_containers=(
  teachnotes-web-1
  teachnotes-demo-1
  teachnotes-cloudflared
  supabase-auth
  supabase-edge-functions
  supabase-storage
  supabase-rest
  supabase-meta
  supabase-kong
  realtime-dev.supabase-realtime
  supabase-pooler
  supabase-imgproxy
  supabase-db
  supabase-studio
)

mkdir -p "$LOG_DIR" "$STATE_DIR"
touch "$LOG_FILE"
chmod 0640 "$LOG_FILE"

container_file=$(mktemp "$STATE_DIR/containers.XXXXXX")
trap 'rm -f "$container_file"' EXIT

is_active() {
  "$SYSTEMCTL_BIN" is-active --quiet "$1" >/dev/null 2>&1
}

boolean_word() {
  if "$@"; then
    printf 'true'
  else
    printf 'false'
  fi
}

send_heartbeat() {
  local url=$1
  local eligible=$2

  if [[ -z $url ]]; then
    printf 'disabled'
    return
  fi
  if [[ $eligible != true ]]; then
    printf 'skipped'
    return
  fi
  if "$CURL_BIN" --fail --silent --show-error \
    --max-time 10 --retry 1 --output /dev/null "$url" >/dev/null 2>&1; then
    printf 'sent'
  else
    printf 'failed'
  fi
}

if [[ -r $PROC_ROOT/sys/kernel/random/boot_id ]]; then
  boot_id=$(tr -d '\n' < "$PROC_ROOT/sys/kernel/random/boot_id")
else
  boot_id=unknown
fi
if [[ -r $PROC_ROOT/uptime ]]; then
  uptime_seconds=$(awk '{printf "%d", $1}' "$PROC_ROOT/uptime")
else
  uptime_seconds=0
fi
if [[ -r $PROC_ROOT/meminfo ]]; then
  memory_available_kib=$(
    awk '/^MemAvailable:/ {print $2; found=1} END {if (!found) print 0}' \
      "$PROC_ROOT/meminfo"
  )
else
  memory_available_kib=0
fi
root_disk_percent=$(df -P / 2>/dev/null | awk 'NR == 2 {gsub(/%/, "", $5); print $5}' || true)
root_disk_percent=${root_disk_percent:-0}
default_route=$("$IP_BIN" route show default 2>/dev/null | head -n 1 || true)

temperature_milli_c=0
if [[ -r $SYS_ROOT/class/thermal/thermal_zone0/temp ]]; then
  temperature_milli_c=$(tr -dc '0-9' < "$SYS_ROOT/class/thermal/thermal_zone0/temp")
elif command -v "$VCGENCMD_BIN" >/dev/null 2>&1; then
  temperature_milli_c=$(
    "$VCGENCMD_BIN" measure_temp 2>/dev/null |
      awk -F "[=\']" '{printf "%d", $2 * 1000}' || true
  )
fi
temperature_milli_c=${temperature_milli_c:-0}
throttled=$("$VCGENCMD_BIN" get_throttled 2>/dev/null | cut -d= -f2 || true)
throttled=${throttled:-unknown}

docker_active=$(boolean_word is_active docker)
ssh_active=$(boolean_word is_active ssh)
tailscaled_active=$(boolean_word is_active tailscaled)

failed_units=$(
  "$SYSTEMCTL_BIN" --failed --plain --no-legend 2>/dev/null |
    awk 'NF {count++} END {print count+0}' || printf '0'
)

tailscale_backend=unknown
tailscale_online=false
if [[ $tailscaled_active == true ]]; then
  tailscale_json=$("$TAILSCALE_BIN" status --json 2>/dev/null || true)
  if [[ -n $tailscale_json ]]; then
    tailscale_result=$(
      "$PYTHON_BIN" -c \
        'import json,sys
try:
    data=json.load(sys.stdin)
    print(data.get("BackendState", "unknown"))
    print("true" if data.get("Self", {}).get("Online") is True else "false")
except Exception:
    print("malformed")
    print("false")' <<<"$tailscale_json"
    )
    tailscale_backend=$(sed -n '1p' <<<"$tailscale_result")
    tailscale_online=$(sed -n '2p' <<<"$tailscale_result")
  fi
fi

docker_reachable=false
stack_ok=true
if [[ $docker_active == true ]] && "$DOCKER_BIN" info >/dev/null 2>&1; then
  docker_reachable=true
  for container_name in "${required_containers[@]}"; do
    container_state=$(
      "$DOCKER_BIN" inspect \
        --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}' \
        "$container_name" 2>/dev/null || true
    )
    if [[ -z $container_state ]]; then
      printf '%s\tmissing\tmissing\t0\tfalse\n' "$container_name" >> "$container_file"
      stack_ok=false
      continue
    fi
    IFS='|' read -r status health restarts oom <<<"$container_state"
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$container_name" "$status" "$health" "$restarts" "$oom" >> "$container_file"
    if [[ $status != running || ($health != healthy && $health != none) || $oom == true ]]; then
      stack_ok=false
    fi
  done
else
  stack_ok=false
  for container_name in "${required_containers[@]}"; do
    printf '%s\tunavailable\tunavailable\t0\tfalse\n' "$container_name" >> "$container_file"
  done
fi

access_ok=false
if [[ $ssh_active == true &&
      $tailscaled_active == true &&
      $tailscale_backend == Running &&
      $tailscale_online == true ]]; then
  access_ok=true
fi

public_web_ok=false
public_web_body=$(
  "$CURL_BIN" --fail --silent --show-error --max-time 10 \
    "$PUBLIC_WEB_HEALTH_URL" 2>/dev/null || true
)
if grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$public_web_body"; then
  public_web_ok=true
fi

pi_heartbeat=$(send_heartbeat "${UPTIMEROBOT_PI_HEARTBEAT_URL:-}" true)
access_heartbeat=$(send_heartbeat "${UPTIMEROBOT_ACCESS_HEARTBEAT_URL:-}" "$access_ok")
stack_heartbeat=$(send_heartbeat "${UPTIMEROBOT_STACK_HEARTBEAT_URL:-}" "$stack_ok")

timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
snapshot=$(
  MONITOR_TIMESTAMP="$timestamp" \
  MONITOR_BOOT_ID="$boot_id" \
  MONITOR_UPTIME_SECONDS="$uptime_seconds" \
  MONITOR_MEMORY_AVAILABLE_KIB="$memory_available_kib" \
  MONITOR_ROOT_DISK_PERCENT="$root_disk_percent" \
  MONITOR_TEMPERATURE_MILLI_C="$temperature_milli_c" \
  MONITOR_THROTTLED="$throttled" \
  MONITOR_FAILED_UNITS="$failed_units" \
  MONITOR_DEFAULT_ROUTE="$default_route" \
  MONITOR_DOCKER_ACTIVE="$docker_active" \
  MONITOR_DOCKER_REACHABLE="$docker_reachable" \
  MONITOR_ACCESS_OK="$access_ok" \
  MONITOR_SSH_ACTIVE="$ssh_active" \
  MONITOR_TAILSCALED_ACTIVE="$tailscaled_active" \
  MONITOR_TAILSCALE_BACKEND="$tailscale_backend" \
  MONITOR_TAILSCALE_ONLINE="$tailscale_online" \
  MONITOR_STACK_OK="$stack_ok" \
  MONITOR_PUBLIC_WEB_OK="$public_web_ok" \
  MONITOR_PI_HEARTBEAT="$pi_heartbeat" \
  MONITOR_ACCESS_HEARTBEAT="$access_heartbeat" \
  MONITOR_STACK_HEARTBEAT="$stack_heartbeat" \
  "$PYTHON_BIN" - "$container_file" <<'PYTHON'
import json
import os
import sys

def integer(name):
    try:
        return int(os.environ.get(name, "0"))
    except ValueError:
        return 0

def boolean(name):
    return os.environ.get(name) == "true"

containers = {}
with open(sys.argv[1], encoding="utf-8") as rows:
    for row in rows:
        fields = row.rstrip("\n").split("\t")
        if len(fields) != 5:
            continue
        name, status, health, restarts, oom = fields
        containers[name] = {
            "status": status,
            "health": health,
            "restarts": int(restarts) if restarts.isdigit() else 0,
            "oom_killed": oom == "true",
        }

print(json.dumps({
    "timestamp": os.environ["MONITOR_TIMESTAMP"],
    "boot_id": os.environ["MONITOR_BOOT_ID"],
    "uptime_seconds": integer("MONITOR_UPTIME_SECONDS"),
    "host": {
        "memory_available_kib": integer("MONITOR_MEMORY_AVAILABLE_KIB"),
        "root_disk_percent": integer("MONITOR_ROOT_DISK_PERCENT"),
        "temperature_milli_c": integer("MONITOR_TEMPERATURE_MILLI_C"),
        "throttled": os.environ["MONITOR_THROTTLED"],
        "failed_systemd_units": integer("MONITOR_FAILED_UNITS"),
        "default_route": os.environ["MONITOR_DEFAULT_ROUTE"],
        "docker_active": boolean("MONITOR_DOCKER_ACTIVE"),
        "docker_reachable": boolean("MONITOR_DOCKER_REACHABLE"),
    },
    "access": {
        "healthy": boolean("MONITOR_ACCESS_OK"),
        "ssh_active": boolean("MONITOR_SSH_ACTIVE"),
        "tailscaled_active": boolean("MONITOR_TAILSCALED_ACTIVE"),
        "tailscale_backend": os.environ["MONITOR_TAILSCALE_BACKEND"],
        "tailscale_online": boolean("MONITOR_TAILSCALE_ONLINE"),
    },
    "stack": {
        "healthy": boolean("MONITOR_STACK_OK"),
        "public_web_healthy": boolean("MONITOR_PUBLIC_WEB_OK"),
        "containers": containers,
    },
    "heartbeats": {
        "pi": os.environ["MONITOR_PI_HEARTBEAT"],
        "access": os.environ["MONITOR_ACCESS_HEARTBEAT"],
        "stack": os.environ["MONITOR_STACK_HEARTBEAT"],
    },
}, separators=(",", ":"), sort_keys=True))
PYTHON
)

(
  "$FLOCK_BIN" -x 9
  printf '%s\n' "$snapshot" >> "$LOG_FILE"
) 9>"$STATE_DIR/status.lock"

"$LOGGER_BIN" --tag teachnotes-monitor -- "$snapshot" >/dev/null 2>&1 || true

if [[ $stack_ok != true || $access_ok != true || $pi_heartbeat == failed ]]; then
  printf '%s\n' "$snapshot"
fi
