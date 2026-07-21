# Commit and Raspberry Pi release pipeline

This pipeline separates three concerns:

1. `scripts/commit-checked.sh` creates one explicit, validated commit and pushes it.
2. GitHub Actions validates every pushed commit and pull request.
3. `scripts/deploy-pi.sh` deploys only a clean, pushed commit whose CI run passed.

The Pi does not build from its long-lived checkout. Each release uses a detached
worktree under `/home/dantheman/releases/teachnotes/<commit-sha>`, so local edits
in `/home/dantheman/code/teachnotes` cannot leak into the Docker image or block a
pull. The existing web container remains online until the replacement image has
built successfully.

## One-time setup

Commit these pipeline files to the current production branch. In GitHub, protect
the production branch and require the `TeachNotes CI / verify` check before
merging. Keep `deploy/pi/app.env` and `deploy/pi/tunnel.env` only on the Pi.

The Mac needs authenticated `git`, `gh`, and `ssh dantheman` access. The Pi needs
Git, Docker Compose, `curl`, `wget`, and `flock`.

## Normal release

Choose the exact paths that belong in one commit:

```bash
scripts/commit-checked.sh "describe the change" -- \
  src/path/to/change.ts \
  tests/path/to/change.test.ts
```

The commit command refuses pre-existing staged changes, checks that the local
branch starts at `origin/<branch>`, and stages only the paths after `--`. It then
creates a temporary commit and worktree, runs `npm ci`, lint, unit tests, and the
Next.js route/type checks against that exact snapshot. Only the validated tree
is committed and pushed. Unselected working-tree changes are preserved. The
clean Linux production build runs in GitHub Actions and is a required deploy
gate, avoiding local Turbopack stalls on macOS.

Wait for CI, then deploy from a clean worktree:

```bash
scripts/deploy-pi.sh
```

The deploy command requires all of the following before it touches production:

- the Mac working tree is clean;
- local `HEAD` exactly matches the pushed branch tip;
- the GitHub Actions run for that SHA completed successfully;
- the user confirms the production deployment.

On the Pi, the release command fetches without pulling into the dirty long-lived
checkout, builds the exact commit in an isolated worktree, replaces only the
`web` service, waits for internal container health, and then checks the public
health and login endpoints. Supabase and Cloudflare Tunnel are not recreated.

## Database migrations

The web release stops if `supabase/migrations` changed since the previous release.
For a migration release:

1. Run and verify `/home/dantheman/code/teachnotes/deploy/pi/backup.sh` on the Pi.
2. Apply the forward-only production migration using the established Supabase
   production procedure. Never use `db reset`.
3. Verify the database and authentication behavior.
4. Deploy the reviewed web commit with:

   ```bash
   scripts/deploy-pi.sh --migration-diff-reviewed
   ```

The flag is an acknowledgement; the deployment script never applies or reverses
a database migration.

## Failure and rollback behavior

- A build failure leaves the existing container running.
- Before replacement, the current image is tagged as
  `teachnotes-web:rollback-<previous-sha>`.
- If the new container fails internal health, the script automatically recreates
  the web service from the previous image and prints recent logs.
- A public endpoint failure does not roll back an internally healthy app because
  it may be a Cloudflare or tunnel problem. The command exits with a clear error
  so origin and edge health can be investigated separately.
- Release worktrees are retained for traceability. Remove an old one only after
  confirming it is not the current release and no rollback needs it.

For a code rollback, revert the faulty Git commit, let CI pass, and deploy the
new revert commit through the same pipeline. Database rollback is intentionally
not automated.
