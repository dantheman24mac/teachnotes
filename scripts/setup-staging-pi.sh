#!/usr/bin/env bash
set -Eeuo pipefail
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not in a Git repository"; cd "$repo_root"
branch=$(git branch --show-current); [[ -n $branch ]] || die "detached HEAD"
[[ -z $(git status --porcelain) ]] || die "working tree must be clean"
sha=$(git rev-parse HEAD)
[[ $(git ls-remote --exit-code origin "refs/heads/$branch" | awk '{print $1}') == "$sha" ]] || die "HEAD must be pushed"
repo_slug=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
run_id=$(gh run list --repo "$repo_slug" --workflow ci.yml --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
[[ -n $run_id ]] || die "no CI run exists for $sha"; gh run watch "$run_id" --repo "$repo_slug" --exit-status
ssh -o BatchMode=yes -o ConnectTimeout=10 dantheman bash -s -- "$sha" "$branch" <<'REMOTE'
set -Eeuo pipefail
sha=$1; branch=$2; repo=/home/dantheman/code/teachnotes; release_root=/home/dantheman/releases/teachnotes-staging; release_dir="$release_root/$sha"
git -C "$repo" fetch --quiet --prune origin "$branch"
[[ $(git -C "$repo" rev-parse "refs/remotes/origin/${branch}^{commit}") == "$sha" ]] || exit 1
mkdir -p "$release_root"
[[ -e $release_dir ]] || git -C "$repo" worktree add --quiet --detach "$release_dir" "$sha"
bash "$release_dir/deploy/pi/staging/setup.sh" "$sha" "$branch"
REMOTE
