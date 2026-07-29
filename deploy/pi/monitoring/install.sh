#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

mode=install
if [[ ${1:-} == "--check" ]]; then
  mode=check
  shift
fi
[[ $# -eq 0 ]] || die "usage: install.sh [--check]"
[[ $EUID -eq 0 ]] || die "run this installer as root"

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

required_files=(
  teachnotes-monitor.sh
  teachnotes-diagnose.sh
  teachnotes-boot-report.sh
  monitor.env.example
  teachnotes-monitor.service
  teachnotes-monitor.timer
  teachnotes-boot-report.service
  journald-retention.conf
  logrotate.conf
  tmpfiles.conf
)
for file in "${required_files[@]}"; do
  [[ -f $source_dir/$file ]] || die "missing $source_dir/$file"
done

declare -A installed_files=(
  [teachnotes-monitor.sh]=/usr/local/sbin/teachnotes-monitor
  [teachnotes-diagnose.sh]=/usr/local/sbin/teachnotes-diagnose
  [teachnotes-boot-report.sh]=/usr/local/sbin/teachnotes-boot-report
  [teachnotes-monitor.service]=/etc/systemd/system/teachnotes-monitor.service
  [teachnotes-monitor.timer]=/etc/systemd/system/teachnotes-monitor.timer
  [teachnotes-boot-report.service]=/etc/systemd/system/teachnotes-boot-report.service
  [journald-retention.conf]=/etc/systemd/journald.conf.d/teachnotes-retention.conf
  [logrotate.conf]=/etc/logrotate.d/teachnotes-monitor
  [tmpfiles.conf]=/etc/tmpfiles.d/teachnotes-monitor.conf
)

if [[ $mode == check ]]; then
  for source_name in "${!installed_files[@]}"; do
    destination=${installed_files[$source_name]}
    [[ -f $destination ]] || die "missing installed file $destination"
    cmp --silent "$source_dir/$source_name" "$destination" ||
      die "$destination differs from the reviewed source"
  done
  [[ -f /etc/teachnotes/monitor.env ]] || die "missing /etc/teachnotes/monitor.env"
  [[ $(stat -c '%a' /etc/teachnotes/monitor.env) == 600 ]] ||
    die "/etc/teachnotes/monitor.env must have mode 600"
  systemctl is-enabled --quiet teachnotes-monitor.timer ||
    die "teachnotes-monitor.timer is not enabled"
  systemctl is-active --quiet teachnotes-monitor.timer ||
    die "teachnotes-monitor.timer is not active"
  printf 'TeachNotes monitoring installation matches the reviewed source.\n'
  exit 0
fi

install -d -m 0755 /etc/systemd/journald.conf.d
install -d -m 0750 /etc/teachnotes
systemd-tmpfiles --create "$source_dir/tmpfiles.conf"

if [[ ! -f /etc/teachnotes/monitor.env ]]; then
  install -m 0600 "$source_dir/monitor.env.example" /etc/teachnotes/monitor.env
fi
chmod 0600 /etc/teachnotes/monitor.env

install -m 0750 "$source_dir/teachnotes-monitor.sh" /usr/local/sbin/teachnotes-monitor
install -m 0750 "$source_dir/teachnotes-diagnose.sh" /usr/local/sbin/teachnotes-diagnose
install -m 0750 "$source_dir/teachnotes-boot-report.sh" /usr/local/sbin/teachnotes-boot-report
install -m 0644 "$source_dir/teachnotes-monitor.service" /etc/systemd/system/teachnotes-monitor.service
install -m 0644 "$source_dir/teachnotes-monitor.timer" /etc/systemd/system/teachnotes-monitor.timer
install -m 0644 "$source_dir/teachnotes-boot-report.service" /etc/systemd/system/teachnotes-boot-report.service
install -m 0644 "$source_dir/journald-retention.conf" /etc/systemd/journald.conf.d/teachnotes-retention.conf
install -m 0644 "$source_dir/logrotate.conf" /etc/logrotate.d/teachnotes-monitor
install -m 0644 "$source_dir/tmpfiles.conf" /etc/tmpfiles.d/teachnotes-monitor.conf

baseline=/srv/teachnotes/incidents/pre-observability-baseline.txt
if [[ ! -f $baseline ]]; then
  if journalctl --list-boots --no-pager | awk '$1 == "-1" {found=1} END {exit !found}'; then
    /usr/local/sbin/teachnotes-diagnose --boot -1 > "$baseline"
  else
    /usr/local/sbin/teachnotes-diagnose --since '24 hours ago' > "$baseline"
  fi
  chmod 0600 "$baseline"
fi

systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable --now teachnotes-monitor.timer
systemctl enable teachnotes-boot-report.service
systemctl start teachnotes-monitor.service
systemctl start teachnotes-boot-report.service

"$source_dir/install.sh" --check
