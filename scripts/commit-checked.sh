#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/commit-checked.sh [--yes] "commit message" -- PATH [PATH ...]

Stages only the listed paths, validates the exact staged snapshot in an
isolated worktree, commits it, and pushes the current branch to origin.

Options:
  --yes  Skip the final interactive confirmation.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

confirm=false
if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi
if [[ ${1:-} == "--yes" ]]; then
  confirm=true
  shift
fi

[[ $# -ge 3 ]] || {
  usage >&2
  exit 2
}

message=$1
shift
[[ ${1:-} == "--" ]] || die "put -- between the commit message and paths"
shift
[[ $# -gt 0 ]] || die "list at least one path to commit"
[[ -n ${message//[[:space:]]/} ]] || die "the commit message cannot be empty"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a Git repository"
cd "$repo_root"

branch=$(git branch --show-current)
[[ -n $branch ]] || die "detached HEAD cannot be committed by this command"
git remote get-url origin >/dev/null 2>&1 || die "the origin remote is not configured"

if ! git diff --cached --quiet; then
  die "the index already contains staged changes; commit or unstage them before using this command"
fi

printf 'Refreshing origin/%s...\n' "$branch"
git fetch --quiet origin "$branch"
local_head=$(git rev-parse HEAD)
remote_head=$(git rev-parse "refs/remotes/origin/$branch")
[[ $local_head == "$remote_head" ]] || {
  die "local HEAD does not match origin/$branch; reconcile the branch before committing"
}

git add -- "$@"
if git diff --cached --quiet; then
  die "the selected paths contain no changes"
fi

git diff --cached --check
printf '\nSelected commit contents:\n'
git diff --cached --name-status
printf '\nSelected commit size:\n'
git diff --cached --stat

validation_tree=$(git write-tree)
validation_commit=$(git commit-tree "$validation_tree" -p HEAD -m "TeachNotes pre-commit validation")
temp_root=$(mktemp -d "${TMPDIR:-/tmp}/teachnotes-commit-check.XXXXXX")
validation_worktree="$temp_root/worktree"

cleanup() {
  if [[ -n ${validation_worktree:-} && -e $validation_worktree ]]; then
    git worktree remove --force "$validation_worktree" >/dev/null 2>&1 || true
  fi
  if [[ -n ${temp_root:-} && -d $temp_root ]]; then
    rmdir "$temp_root" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

printf '\nValidating the exact staged snapshot...\n'
git worktree add --quiet --detach "$validation_worktree" "$validation_commit"
(
  cd "$validation_worktree"
  export NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-commit-check-placeholder-key}
  export SUPABASE_INTERNAL_URL=${SUPABASE_INTERNAL_URL:-http://127.0.0.1:54321}
  export NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
  export TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-1x00000000000000000000AA}
  npm ci
  npm run lint
  npm test
  npx next typegen
  npx tsc --noEmit
)

if [[ $confirm != true ]]; then
  printf '\nCommit and push this validated snapshot to origin/%s? [y/N] ' "$branch"
  read -r answer
  [[ $answer == "y" || $answer == "Y" ]] || die "cancelled; the selected paths remain staged for review"
fi

git commit -m "$message"
committed_tree=$(git rev-parse 'HEAD^{tree}')
[[ $committed_tree == "$validation_tree" ]] || {
  die "a commit hook changed the validated tree; inspect the local commit before pushing"
}

commit_sha=$(git rev-parse HEAD)
git push origin "HEAD:refs/heads/$branch"
printf '\nCommitted and pushed %s to origin/%s\n' "$commit_sha" "$branch"
