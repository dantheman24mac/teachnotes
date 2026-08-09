#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy-pi.sh [--yes] [--migration-diff-reviewed]

Deploys the clean, pushed HEAD commit after its GitHub Actions CI run succeeds.
The Raspberry Pi builds that exact SHA in an isolated release worktree.

Options:
  --yes                      Skip the production confirmation.
  --migration-diff-reviewed Allow a release that changes supabase/migrations.
                             Use only after the production backup and forward
                             migration have been completed separately.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

confirm=false
migration_diff_reviewed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      confirm=true
      ;;
    --migration-diff-reviewed)
      migration_diff_reviewed=true
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
[[ -n $branch ]] || die "detached HEAD cannot be deployed"
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || die "the branch name contains unsupported characters"
[[ $branch == main ]] || die "production deployment is restricted to main"

if [[ -n $(git status --porcelain) ]]; then
  die "the working tree is not clean; deploy only after every intended change is committed"
fi

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
origin_main_sha=$(git ls-remote --exit-code origin refs/heads/main | awk '{print $1}')
[[ $sha == "$origin_main_sha" ]] || die "local SHA is not the exact origin/main tip"

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

printf 'Verifying exact-SHA staging health and approval...\n'
ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman bash -s -- "$sha" <<'STAGING_GATE'
set -Eeuo pipefail
sha=$1
root=/home/dantheman/releases/teachnotes-staging
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
[[ -f $root/current-sha && $(<"$root/current-sha") == "$sha" ]] || die "staging current SHA does not match production candidate"
[[ -f $root/current-deployment && -f $root/approval ]] || die "staging deployment or approval record is missing"
unset SHA DEPLOYED_AT APPROVED_AT HEALTH_SHA
source "$root/current-deployment"
deployment_sha=$SHA; deployment_at=$DEPLOYED_AT
unset SHA DEPLOYED_AT APPROVED_AT HEALTH_SHA
source "$root/approval"
[[ $SHA == "$sha" && $HEALTH_SHA == "$sha" ]] || die "approval SHA does not match production candidate"
[[ $DEPLOYED_AT == "$deployment_at" && $APPROVED_AT > "$DEPLOYED_AT" ]] || die "staging approval is stale"
body=$(curl -fsS --retry 3 https://staging.teachnotes.fyi/api/health) || die "staging public health failed"
grep -Eq '"environment"[[:space:]]*:[[:space:]]*"staging"' <<<"$body" || die "staging public environment mismatch"
grep -Eq "\"releaseSha\"[[:space:]]*:[[:space:]]*\"$sha\"" <<<"$body" || die "staging public SHA mismatch"
STAGING_GATE

if [[ $confirm != true ]]; then
  printf '\nDeploy %s from %s to the Raspberry Pi? [y/N] ' "$sha" "$branch"
  read -r answer
  [[ $answer == "y" || $answer == "Y" ]] || die "cancelled before production was changed"
fi

remote_args=("$sha" "$branch")
if [[ $migration_diff_reviewed == true ]]; then
  remote_args+=("--migration-diff-reviewed")
fi

printf '\nStarting the isolated Raspberry Pi release...\n'
ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman bash -s -- "${remote_args[@]}" <<'REMOTE_BOOTSTRAP'
set -Eeuo pipefail

sha=$1
branch=$2
shift 2

repo=/home/dantheman/code/teachnotes
cd "$repo"
git fetch --quiet --prune origin "$branch"

remote_sha=$(git rev-parse "refs/remotes/origin/${branch}^{commit}")
[[ $remote_sha == "$sha" ]] || {
  printf 'error: fetched origin/%s is %s, expected %s\n' "$branch" "$remote_sha" "$sha" >&2
  exit 1
}

release_script=$(mktemp /tmp/teachnotes-deploy-release.XXXXXX)
trap 'rm -f "$release_script"' EXIT
git show "$sha:deploy/pi/deploy-release.sh" > "$release_script"
bash "$release_script" "$sha" "$branch" "$@"
REMOTE_BOOTSTRAP
