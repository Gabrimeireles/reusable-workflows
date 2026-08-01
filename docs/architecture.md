# Architecture

## Before

Prior to this rewrite, `reusable-workflows` provided four flat workflows
(`docker-build.yml`, `docker-deploy-ssh.yml`, `github-release.yml`, `swagger-pages.yml`). Only
`docker-build.yml` was actually shared by Pricely; its ~275-line
`deploy-homolog-server.yml` reimplemented, itself: Tailscale, SSH, GHCR auth, compose/env file
upload, remote GHCR login, image pull, dependency startup, Postgres wait-for-ready, backup,
backup verification, retention, migration, optional reset, optional seed, service recreation,
internal + public health checks, image pruning, and diagnostics. Nothing about that sequence was
Pricely-specific in principle, but all of it lived only in Pricely.

## After

Two layers:

1. **Reusable workflows** (`.github/workflows/`) — pure orchestration: job graphs, `needs:`
   ordering, `if:` gating, concurrency, top-level `permissions:`. No business logic.
2. **Composite actions** (`.github/actions/`) — one action per concern, each independently
   testable with Bats and independently reusable (`validate-caller.yml` reuses `resolve-project`
   + `load-config` without pulling in any deploy logic).

See [`docs/adr/0001-reusable-workflows-vs-composite-actions.md`](adr/0001-reusable-workflows-vs-composite-actions.md)
for the reasoning.

### Configuration: hybrid inputs + declarative file

`workflow_call.inputs` has no array/object type, so:

- Values every caller toggles by hand (`project_name`, `environment_name`, `reset_database`,
  `run_seeders`) are plain scalar inputs — visible in the caller's `with:` block and in the
  `workflow_dispatch` UI.
- Values that are inherently list/nested-shaped (images, health checks, database config,
  environment files) live in a declarative YAML file in the **caller's** repository
  (`.github/deploy/<environment>.yml` by default), validated against
  [`.github/schema/deploy-config.schema.json`](../.github/schema/deploy-config.schema.json).

See [`docs/adr/0003-config-model.md`](adr/0003-config-model.md).

### Secrets

Nothing in this repository is ever a secret source for a caller — GitHub Actions only forwards
secrets a caller's own job already has. Full detail:
[`docs/secrets-and-environments.md`](secrets-and-environments.md).

### The deploy sequence

`deploy-stack.yml`'s single job, in order:

1. `resolve-project` — validate names, compute/validate the deploy path.
2. `load-config` — parse and schema-validate the declarative config.
3. **Reset guard** — hard-fail if `reset_database=true` on anything but `workflow_dispatch`.
4. Derive config values (compose services, database fields, env-file slots, health checks) via
   `jq`, and derive the Compose `.env` image lines from `image_refs`.
5. `setup-network` (optional Tailscale) → `setup-ssh`.
6. `deploy-compose` stage `snapshot` — **before any upload**, copy the server's current
   `.env`/compose to `.previous` and capture the previous image references (for rollback).
7. `prepare-deploy-files` → `upload-deploy-files`.
8. `deploy-compose` stage `start` — GHCR login, pull, start dependency services.
9. `backup-postgres` (if a database is enabled) — wait for ready, `pg_dump`, verify, apply
   retention, never delete the backup just taken.
10. `run-database-command` — migration (default) or reset (only if requested and allowed), then
    optionally seed.
11. `deploy-compose` stage `recreate` — recreate application services, prune dangling images.
12. Up to 4 `health-check` steps (HTTP and/or in-Compose-service commands).
13. `deployment-summary` — always runs (`if: always()`), writes `$GITHUB_STEP_SUMMARY`.

### Why the snapshot happens before upload, not after

An earlier draft ran the "snapshot previous state" logic as part of the same remote call that
also uploaded and started services — which would have snapshotted the file *just uploaded*,
not the one it replaced. `deploy-compose`'s `snapshot` stage runs strictly before
`upload-deploy-files`, so `.env.previous`/`docker-compose.previous.yml` genuinely reflect the
prior deploy.

### Compose `.env` composition

The platform derives `<IMAGE_ID>_IMAGE=...` and `IMAGE_TAG=...` lines from the caller's
`image_refs` input (all images in one deploy share one immutable SHA tag — see
[`docs/adr/0004-versioning-strategy.md`](adr/0004-versioning-strategy.md) and Constitution
Principle V) and concatenates them with the caller-owned `COMPOSE_ENV_EXTRA` secret, which holds
everything else the caller's own Compose file needs (database credentials, ports, URLs, ...).
The platform never needs to know these variable names — see
[`docs/adr/0005-project-specific-commands.md`](adr/0005-project-specific-commands.md) for the
same principle applied to migration/reset/seed commands.
