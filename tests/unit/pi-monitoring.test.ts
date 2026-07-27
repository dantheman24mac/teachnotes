import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const monitorScript = resolve(
  process.cwd(),
  "deploy/pi/monitoring/teachnotes-monitor.sh",
);

function executable(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(path, 0o755);
}

function runMonitor(overrides: Record<string, string | undefined> = {}) {
  const root = mkdtempSync(join(tmpdir(), "teachnotes-monitor-test-"));
  const bin = join(root, "bin");
  const proc = join(root, "proc");
  const sys = join(root, "sys");
  const log = join(root, "log");
  const state = join(root, "state");
  const calls = join(root, "heartbeat-calls");

  mkdirSync(bin);
  mkdirSync(join(proc, "sys/kernel/random"), { recursive: true });
  mkdirSync(join(sys, "class/thermal/thermal_zone0"), { recursive: true });
  writeFileSync(
    join(proc, "sys/kernel/random/boot_id"),
    "11111111111111111111111111111111\n",
  );
  writeFileSync(join(proc, "uptime"), "1234.50 2000.00\n");
  writeFileSync(
    join(proc, "meminfo"),
    "MemTotal:       16000000 kB\nMemAvailable:   12000000 kB\n",
  );
  writeFileSync(join(sys, "class/thermal/thermal_zone0/temp"), "42000\n");

  executable(
    join(bin, "systemctl"),
    `
if [ "$1" = "is-active" ]; then
  service="$3"
  if [ "\${ACCESS_DOWN:-0}" = "1" ] && { [ "$service" = "ssh" ] || [ "$service" = "tailscaled" ]; }; then
    exit 3
  fi
  if [ "\${DOCKER_DOWN:-0}" = "1" ] && [ "$service" = "docker" ]; then
    exit 3
  fi
  exit 0
fi
if [ "$1" = "--failed" ]; then
  if [ "\${FAILED_UNITS:-0}" = "1" ]; then
    printf 'broken.service loaded failed failed Broken\\n'
  fi
  exit 0
fi
exit 0`,
  );

  executable(
    join(bin, "docker"),
    `
if [ "$1" = "info" ]; then
  [ "\${DOCKER_DOWN:-0}" != "1" ]
  exit
fi
if [ "$1" = "inspect" ]; then
  name=
  for argument in "$@"; do
    name=$argument
  done
  if [ "\${MISSING_CONTAINER:-}" = "$name" ]; then
    exit 1
  fi
  if [ "\${UNHEALTHY_CONTAINER:-}" = "$name" ]; then
    printf 'running|unhealthy|2|false\\n'
  elif [ "$name" = "teachnotes-cloudflared" ]; then
    printf 'running|none|0|false\\n'
  else
    printf 'running|healthy|0|false\\n'
  fi
  exit 0
fi
exit 1`,
  );

  executable(
    join(bin, "tailscale"),
    `
if [ "\${MALFORMED_TAILSCALE:-0}" = "1" ]; then
  printf 'not-json\\n'
elif [ "\${TAILSCALE_OFFLINE:-0}" = "1" ]; then
  printf '{"BackendState":"Running","Self":{"Online":false}}\\n'
else
  printf '{"BackendState":"Running","Self":{"Online":true}}\\n'
fi`,
  );

  executable(
    join(bin, "curl"),
    `
url=
for argument in "$@"; do
  url=$argument
done
if [ "\${CURL_FAIL:-0}" = "1" ]; then
  exit 22
fi
case "$url" in
  *heartbeat*)
    printf '%s\\n' "$url" >> "$HEARTBEAT_CALLS"
    ;;
  *)
    printf '{"ok":true,"service":"teachnotes"}\\n'
    ;;
esac`,
  );

  executable(join(bin, "ip"), "printf 'default via 192.0.2.1 dev eth0\\n'");
  executable(join(bin, "flock"), "exit 0");
  executable(join(bin, "logger"), "exit 0");
  executable(
    join(bin, "vcgencmd"),
    `
if [ "\${1:-}" = "get_throttled" ]; then
  printf 'throttled=0x0\\n'
else
  printf "temp=42.0'C\\n"
fi`,
  );

  execFileSync("/bin/bash", [monitorScript], {
    env: {
      ...process.env,
      TEACHNOTES_MONITOR_LOG_DIR: log,
      TEACHNOTES_MONITOR_STATE_DIR: state,
      TEACHNOTES_PROC_ROOT: proc,
      TEACHNOTES_SYS_ROOT: sys,
      CURL_BIN: join(bin, "curl"),
      DOCKER_BIN: join(bin, "docker"),
      FLOCK_BIN: join(bin, "flock"),
      IP_BIN: join(bin, "ip"),
      LOGGER_BIN: join(bin, "logger"),
      SYSTEMCTL_BIN: join(bin, "systemctl"),
      TAILSCALE_BIN: join(bin, "tailscale"),
      VCGENCMD_BIN: join(bin, "vcgencmd"),
      HEARTBEAT_CALLS: calls,
      UPTIMEROBOT_PI_HEARTBEAT_URL: "https://heartbeat.example/pi-token",
      UPTIMEROBOT_ACCESS_HEARTBEAT_URL:
        "https://heartbeat.example/access-token",
      UPTIMEROBOT_STACK_HEARTBEAT_URL:
        "https://heartbeat.example/stack-token",
      ...overrides,
    },
    stdio: "pipe",
  });

  const snapshotText = readFileSync(join(log, "status.jsonl"), "utf8").trim();
  const heartbeatCalls = (() => {
    try {
      return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  })();

  return {
    snapshot: JSON.parse(snapshotText),
    snapshotText,
    heartbeatCalls,
  };
}

describe("Pi monitoring snapshot", () => {
  it("records a healthy host, access path and stack and sends all heartbeats", () => {
    const result = runMonitor();

    expect(result.snapshot.access.healthy).toBe(true);
    expect(result.snapshot.stack.healthy).toBe(true);
    expect(result.snapshot.stack.public_web_healthy).toBe(true);
    expect(result.snapshot.heartbeats).toEqual({
      access: "sent",
      pi: "sent",
      stack: "sent",
    });
    expect(result.heartbeatCalls).toHaveLength(3);
    expect(result.snapshotText).not.toContain("heartbeat.example");
    expect(result.snapshotText).not.toContain("token");
  });

  it("does not send the stack heartbeat when a required container is missing", () => {
    const result = runMonitor({ MISSING_CONTAINER: "supabase-db" });

    expect(result.snapshot.stack.healthy).toBe(false);
    expect(result.snapshot.stack.containers["supabase-db"].status).toBe(
      "missing",
    );
    expect(result.snapshot.heartbeats.stack).toBe("skipped");
    expect(result.heartbeatCalls).toHaveLength(2);
  });

  it("does not send the stack heartbeat for an unhealthy container", () => {
    const result = runMonitor({ UNHEALTHY_CONTAINER: "supabase-auth" });

    expect(result.snapshot.stack.healthy).toBe(false);
    expect(result.snapshot.stack.containers["supabase-auth"]).toMatchObject({
      health: "unhealthy",
      restarts: 2,
    });
    expect(result.snapshot.heartbeats.stack).toBe("skipped");
  });

  it("does not send the access heartbeat when Tailscale is offline", () => {
    const result = runMonitor({ TAILSCALE_OFFLINE: "1" });

    expect(result.snapshot.access.healthy).toBe(false);
    expect(result.snapshot.access.tailscale_online).toBe(false);
    expect(result.snapshot.heartbeats.access).toBe("skipped");
  });

  it("handles malformed Tailscale output as an access failure", () => {
    const result = runMonitor({ MALFORMED_TAILSCALE: "1" });

    expect(result.snapshot.access.healthy).toBe(false);
    expect(result.snapshot.access.tailscale_backend).toBe("malformed");
    expect(result.snapshot.heartbeats.access).toBe("skipped");
  });

  it("records Docker unavailability without failing the monitor run", () => {
    const result = runMonitor({ DOCKER_DOWN: "1" });

    expect(result.snapshot.host.docker_active).toBe(false);
    expect(result.snapshot.host.docker_reachable).toBe(false);
    expect(result.snapshot.stack.healthy).toBe(false);
    expect(
      result.snapshot.stack.containers["teachnotes-web-1"].status,
    ).toBe("unavailable");
  });

  it("records outbound failures for every eligible heartbeat", () => {
    const result = runMonitor({ CURL_FAIL: "1" });

    expect(result.snapshot.stack.public_web_healthy).toBe(false);
    expect(result.snapshot.heartbeats).toEqual({
      access: "failed",
      pi: "failed",
      stack: "failed",
    });
  });

  it("supports local logging before heartbeat credentials are configured", () => {
    const result = runMonitor({
      UPTIMEROBOT_PI_HEARTBEAT_URL: "",
      UPTIMEROBOT_ACCESS_HEARTBEAT_URL: "",
      UPTIMEROBOT_STACK_HEARTBEAT_URL: "",
    });

    expect(result.snapshot.heartbeats).toEqual({
      access: "disabled",
      pi: "disabled",
      stack: "disabled",
    });
    expect(result.heartbeatCalls).toHaveLength(0);
  });
});
