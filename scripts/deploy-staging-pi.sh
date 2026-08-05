#!/usr/bin/env bash
set -Eeuo pipefail
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not in a Git repository"
cd "$repo_root"
branch=$(git branch --show-current); [[ -n $branch ]] || die "detached HEAD cannot be staged"
[[ -z $(git status --porcelain) ]] || die "working tree must be clean"
sha=$(git rev-parse HEAD); [[ $sha =~ ^[0-9a-f]{40}$ ]] || die "invalid SHA"
remote_sha=$(git ls-remote --exit-code origin "refs/heads/$branch" | awk '{print $1}')
[[ $remote_sha == "$sha" ]] || die "HEAD is not the pushed origin/$branch tip"
repo_slug=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
run_id=$(gh run list --repo "$repo_slug" --workflow ci.yml --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
[[ -n $run_id ]] || die "no CI run exists for $sha"
gh run watch "$run_id" --repo "$repo_slug" --exit-status

ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman bash -s -- "$sha" "$branch" <<'REMOTE'
set -Eeuo pipefail
sha=$1; branch=$2; repo=/home/dantheman/code/teachnotes
git -C "$repo" fetch --quiet --prune origin "$branch"
[[ $(git -C "$repo" rev-parse "refs/remotes/origin/${branch}^{commit}") == "$sha" ]] || { printf 'error: fetched branch mismatch\n' >&2; exit 1; }
release_root=/home/dantheman/releases/teachnotes-staging
release_dir="$release_root/$sha"
mkdir -p "$release_root"
if [[ ! -e $release_dir ]]; then git -C "$repo" worktree add --quiet --detach "$release_dir" "$sha"; fi
[[ $(git -C "$release_dir" rev-parse HEAD) == "$sha" ]] || { printf 'error: release worktree mismatch\n' >&2; exit 1; }
bash "$release_dir/deploy/pi/staging/deploy-release.sh" "$sha" "$branch"
REMOTE
