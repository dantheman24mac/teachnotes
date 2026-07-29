# Raspberry Pi outage logging and monitoring

TeachNotes uses local evidence on the Raspberry Pi and independent UptimeRobot
checks. The local evidence explains failures after access returns; UptimeRobot
records the externally observed down and recovery times while the Pi cannot
write logs.

The monitor observes and alerts only. It does not restart the host, Tailscale,
SSH, Cloudflare Tunnel, TeachNotes or Supabase. Existing Docker restart policies
remain unchanged.

## Signals

The `teachnotes-monitor.timer` runs every five minutes and appends one JSON
snapshot to `/var/log/teachnotes-monitor/status.jsonl`. Each snapshot includes:

- boot ID, uptime, memory, root-disk use, CPU temperature and throttle flags;
- failed systemd units, default route and Docker daemon availability;
- SSH and Tailscale service, backend and online state;
- status, Docker health, restart count and OOM state for TeachNotes, demo,
  Cloudflare Tunnel and the eleven Supabase containers;
- the public TeachNotes health result; and
- whether each configured UptimeRobot heartbeat was sent, skipped or failed.

The same JSON is written to the system journal under the
`teachnotes-monitor` identifier. The JSON never contains heartbeat URLs,
application environment variables, request bodies or user data.

At every boot, `teachnotes-boot-report.service` creates a mode-600 report under
`/srv/teachnotes/incidents`. It classifies the preceding boot as clean or
unclean and includes bounded shutdown, SSH, sudo, kernel, network, Docker and
endpoint evidence. UptimeRobot timestamps remain the external time source if
the Pi clock is initially wrong after a long power loss.

## Private configuration

The installer creates `/etc/teachnotes/monitor.env` with mode `600`. Add the
three generated heartbeat URLs without quotes:

```dotenv
UPTIMEROBOT_PI_HEARTBEAT_URL=https://heartbeat.uptimerobot.com/...
UPTIMEROBOT_ACCESS_HEARTBEAT_URL=https://heartbeat.uptimerobot.com/...
UPTIMEROBOT_STACK_HEARTBEAT_URL=https://heartbeat.uptimerobot.com/...
```

Restart only the monitoring timer after changing it:

```bash
sudo systemctl restart teachnotes-monitor.timer
sudo systemctl start teachnotes-monitor.service
```

The heartbeat URLs are credentials because a caller could spoof an `UP`
signal. Do not commit, print or place them in Discord. The Discord webhook is
entered directly in UptimeRobot and is never stored on the Pi.

## UptimeRobot configuration

Create a free account, then create these monitors at five-minute intervals:

1. `TeachNotes web - public`: HTTP GET
   `https://teachnotes.fyi/api/health`, requiring HTTP 200.
2. `TeachNotes Supabase Auth - public`: HTTP GET
   `https://api.teachnotes.fyi/auth/v1/health`, requiring HTTP 200 and using
   only the browser-safe publishable key as the `apikey` header.
3. `TeachNotes Pi - alive`: heartbeat every five minutes with five minutes of
   grace.
4. `TeachNotes Pi - Tailscale and SSH`: heartbeat every five minutes with five
   minutes of grace.
5. `TeachNotes - internal stack`: heartbeat every five minutes with five
   minutes of grace.

Create a dedicated `#teachnotes-alerts` Discord channel and webhook. Add it as a
UptimeRobot Discord integration for down and recovery events only, and attach
it to all five monitors. Never enter the Supabase secret key in UptimeRobot;
the publishable key is sufficient for the public Auth health route.

## Diagnosis matrix

| Signals | Likely fault domain |
| --- | --- |
| Pi heartbeat and public endpoints down | Pi power, router, ISP or outbound connectivity |
| Pi heartbeat up, internal stack down | Docker or a local application dependency |
| Internal stack up, public endpoint down | Cloudflare, DNS, certificate or Tunnel routing |
| Public services up, access heartbeat down | Tailscale or SSH |
| Journal shows a shutdown command and clean poweroff | Intentional or software-requested shutdown |
| Journal ends without a clean shutdown sequence | Power loss, freeze or abrupt reset |

A total power and home-internet outage cannot be distinguished while it is
happening. The next boot report supplies the local evidence. Exact electrical
power telemetry requires a UPS or separate energy monitor.

## Installation and verification

After the monitoring commit is pushed and CI passes:

```bash
scripts/install-pi-monitoring.sh
ssh dantheman 'sudo /usr/local/sbin/teachnotes-diagnose --since "24 hours ago"'
ssh dantheman 'sudo /usr/local/sbin/teachnotes-diagnose --boot -1'
```

The first install archives the preceding boot in
`/srv/teachnotes/incidents/pre-observability-baseline.txt` before restarting
the journal with its bounded retention policy. Re-running the installer is
safe; `--check` compares installed files and permissions with the reviewed
source.

To verify without stopping production:

```bash
ssh dantheman 'sudo systemctl start teachnotes-monitor.service'
ssh dantheman 'sudo systemctl status teachnotes-monitor.timer --no-pager'
ssh dantheman 'sudo tail -n 1 /var/log/teachnotes-monitor/status.jsonl'
```

Use UptimeRobot's test notification for Discord. Test down/recovery behavior
with a disposable heartbeat monitor rather than stopping the Pi, Tailscale or
production containers.
