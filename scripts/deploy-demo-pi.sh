#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a Git repository"
cd "$repo_root"
[[ -z $(git status --porcelain) ]] || die "the working tree must be clean"

branch=$(git branch --show-current)
sha=$(git rev-parse HEAD)
[[ -n $branch && $branch =~ ^[A-Za-z0-9._/-]+$ ]] || die "unsupported or detached branch"
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "could not resolve HEAD"

remote_sha=$(git ls-remote --exit-code origin "refs/heads/$branch" | awk '{print $1}')
[[ $remote_sha == "$sha" ]] || die "HEAD is not the pushed origin/$branch tip"

repo_slug=$(git remote get-url origin)
repo_slug=${repo_slug#https://github.com/}
repo_slug=${repo_slug#git@github.com:}
repo_slug=${repo_slug%.git}
run_id=$(gh run list --repo "$repo_slug" --workflow ci.yml --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
[[ -n $run_id ]] || die "no TeachNotes CI run exists for $sha"
gh run watch "$run_id" --repo "$repo_slug" --exit-status

ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman bash -s -- "$sha" "$branch" <<'REMOTE_BOOTSTRAP'
set -Eeuo pipefail
sha=$1
branch=$2
repo=/home/dantheman/code/teachnotes
git -C "$repo" fetch --quiet --prune origin "$branch"
[[ $(git -C "$repo" rev-parse "refs/remotes/origin/${branch}^{commit}") == "$sha" ]]
release_script=$(mktemp /tmp/teachnotes-demo-release.XXXXXX)
trap 'rm -f "$release_script"' EXIT
git -C "$repo" show "$sha:deploy/pi/deploy-demo-release.sh" > "$release_script"
bash "$release_script" "$sha" "$branch"
REMOTE_BOOTSTRAP
