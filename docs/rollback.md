# Manual Rollback

This platform ships **manual-only** rollback in v1 by design — see
[`docs/adr/0006-rollback-strategy.md`](adr/0006-rollback-strategy.md) for why an automatic one
would be unsafe for a platform that treats migration/reset/seed commands as opaque (per
[ADR 0005](adr/0005-project-specific-commands.md)).

## What's preserved for you, automatically

- **Immutable image tags** — every previously-deployed image reference is always re-pullable.
- **`docker-compose.previous.yml` and `.env.previous`** on the server, written by
  `deploy-compose`'s `snapshot` stage *before* any new file is uploaded, so they genuinely
  reflect the prior running state.
- **Every pre-deploy database backup**, verified with `pg_restore --list` and retained per the
  config's `database.backup.retentionDays` (never deleting the backup the current run just took).
- **A `release-manifest.json`** on the server and as a workflow artifact (Iteration 2 — see
  [`docs/release-manifest.md`](release-manifest.md)), with a literal `rollbackCommand` field —
  copy-paste it instead of retyping the command below. The previous run's manifest is preserved
  as `release-manifest.previous.json` alongside the previous `.env`/Compose files.
- **The deploy run's step summary**, rendered from that manifest, listing the previous and new
  image references, the backup file path, and the rollback command.

## Rolling back the application (containers only)

Read `rollbackCommand` from `release-manifest.json` (or the run's step summary) and run it
verbatim on the server, in the deploy path (`/srv/stacks/<project>`). It is exactly:

```sh
docker compose --env-file .env.previous -f docker-compose.previous.yml up -d --force-recreate
```

(add a `pull` first if the previous images may have been pruned locally). This restores the
previously-running images and Compose configuration. It does **not** touch the database.

## Rolling back the database

Only do this if the new migration actually needs reverting (many migrations are additive and
don't need this step).

1. Stop the application services referencing the database:
   `docker compose -f docker-compose.yml stop <app-services>`
2. Restore the pre-deploy backup named in the run summary:
   ```sh
   docker compose exec -T <db-service> sh -lc \
     'pg_restore -U "$0" -d "$1" --clean --if-exists' \
     <containerUser> <containerDatabase> < backups/pre-deploy-<tag>-<timestamp>.dump
   ```
3. Restart the application services against the restored database and previous image (see above).

## After a rollback

- Re-run the health checks manually (the URLs/commands are in your
  `.github/deploy/<environment>.yml`) to confirm the rollback succeeded.
- Investigate the failure before re-attempting the forward deploy — a `deploy-stack.yml` run's
  summary and logs are the first place to look (see
  [`docs/troubleshooting.md`](troubleshooting.md)).
