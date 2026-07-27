#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/install-pi-monitoring.sh [--yes]

Installs the monitoring files from the clean, pushed HEAD commit after its
GitHub Actions CI run succeeds. The Raspberry Pi installs from a temporary
archive of that exact commit.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

confirm=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      confirm=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
  shift
done

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a Git repository"
cd "$repo_root"

branch=$(git branch --show-current)
[[ -n $branch ]] || die "detached HEAD cannot be installed"
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || die "the branch name contains unsupported characters"
[[ -z $(git status --porcelain) ]] ||
  die "the working tree is not clean; install only a reviewed commit"

sha=$(git rev-parse HEAD)
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "could not resolve a full commit SHA"

remote_url=$(git remote get-url origin 2>/dev/null) || die "the origin remote is not configured"
case "$remote_url" in
  https://github.com/*)
    repo_slug=${remote_url#https://github.com/}
    ;;
  git@github.com:*)
    repo_slug=${remote_url#git@github.com:}
    ;;
  *)
    die "origin must be a GitHub HTTPS or SSH URL so CI can be verified"
    ;;
esac
repo_slug=${repo_slug%.git}

printf 'Verifying that %s is pushed to origin/%s...\n' "$sha" "$branch"
remote_sha=$(git ls-remote --exit-code origin "refs/heads/$branch" | awk '{print $1}')
[[ $sha == "$remote_sha" ]] || die "local HEAD is not the pushed tip of origin/$branch"

command -v gh >/dev/null 2>&1 || die "GitHub CLI is required to verify the CI gate"
run_id=$(gh run list \
  --repo "$repo_slug" \
  --workflow ci.yml \
  --commit "$sha" \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId // empty')
[[ -n $run_id ]] || die "no TeachNotes CI run exists for $sha yet"

printf 'Waiting for GitHub Actions run %s...\n' "$run_id"
gh run watch "$run_id" --repo "$repo_slug" --exit-status

if [[ $confirm != true ]]; then
  printf '\nInstall monitoring from %s on the Raspberry Pi? [y/N] ' "$sha"
  read -r answer
  [[ $answer == "y" || $answer == "Y" ]] || die "cancelled before the Pi was changed"
fi

ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman bash -s -- "$sha" "$branch" <<'REMOTE_INSTALL'
set -Eeuo pipefail

sha=$1
branch=$2
repo=/home/dantheman/code/teachnotes

cd "$repo"
git fetch --quiet --prune origin "$branch"
remote_sha=$(git rev-parse "refs/remotes/origin/${branch}^{commit}")
[[ $remote_sha == "$sha" ]] || {
  printf 'error: fetched origin/%s is %s, expected %s\n' "$branch" "$remote_sha" "$sha" >&2
  exit 1
}

archive=$(mktemp /tmp/teachnotes-monitoring.XXXXXX.tar)
install_root=$(mktemp -d /tmp/teachnotes-monitoring.XXXXXX)
trap 'rm -f "$archive"; rm -rf "$install_root"' EXIT

git archive --format=tar --output="$archive" "$sha" deploy/pi/monitoring
tar -xf "$archive" -C "$install_root"
sudo "$install_root/deploy/pi/monitoring/install.sh"
sudo "$install_root/deploy/pi/monitoring/install.sh" --check
REMOTE_INSTALL
