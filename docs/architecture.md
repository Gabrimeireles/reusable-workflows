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

`deploy-stack.yml`'s single job, in order (hook steps in *italics* are `if:`-gated no-ops when
undeclared — see [`docs/hooks.md`](hooks.md)):

1. `resolve-project` — validate names, compute/validate the deploy path.
2. `load-config` — resolve plugins, then parse and schema/semantic-validate the declarative
   config (see "Iteration 2" below).
3. **Reset guard** — hard-fail if `reset_database=true` on anything but `workflow_dispatch`.
4. Derive config values (compose services, database fields, env-file slots, health checks,
   resolved hook commands) via `jq`, and derive the Compose `.env` image lines from `image_refs`.
5. `setup-network` (optional Tailscale) → `setup-ssh`.
6. *`pre_deploy` hook* → `deploy-compose` stage `snapshot` — **before any upload**, copy the
   server's current `.env`/compose/manifest to `.previous` and capture the previous image
   references (for rollback).
7. `prepare-deploy-files` (also computes Compose/`.env` checksums) → `upload-deploy-files`.
8. `deploy-compose` stage `start` — GHCR login, pull, start dependency services.
9. *`pre_backup` hook* → `backup-postgres` (if a database is enabled) → *`post_backup` hook*.
10. *`pre_migration` hook* → `run-remote-command` — migration (default) or reset (only if
    requested and allowed) → *`post_migration` hook* → optionally seed.
11. `deploy-compose` stage `recreate` — recreate application services (no longer prunes; see
    "cleanup" below).
12. *`post_deploy` hook* → *`pre_healthcheck` hook* → up to 4 `health-check` steps → *`post_healthcheck` hook*.
13. *`pre_cleanup` hook* → `deploy-compose` stage `cleanup` (prune dangling images) →
    *`post_cleanup` hook*.
14. Per-phase timing computed from checkpoints taken throughout → `release-manifest` (writes
    `release-manifest.json` to the server and exposes it for a workflow artifact) →
    `deployment-summary` (renders `$GITHUB_STEP_SUMMARY` **from** the manifest — always runs,
    `if: always()`).

### Iteration 2: matrix build, plugins, hooks, manifest

- **`ci-cd.yml`** is the new recommended entry point: `load` (checkout + `load-config`) → `build`
  (matrix over the config's `images`, one `docker-build.yml` call per image, no per-image job
  needed in the caller) → `collect` (artifact-based fan-in of each image's ref/digest/size into
  the `image_refs`/`image_details` JSON `deploy-stack.yml` expects) → `deploy`
  (`deploy-stack.yml`). See [`docs/adr/0008-build-matrix-fanin.md`](adr/0008-build-matrix-fanin.md)
  for why the fan-in needs an artifact round-trip (GitHub Actions doesn't aggregate matrix job
  outputs across instances) and why the artifact upload has to live inside `docker-build.yml`
  itself (a job whose `uses:` calls a reusable workflow cannot have its own extra steps).
- **Plugins** (`docs/plugins.md`) resolve entirely inside the Node config loader via dynamic
  `import()` — never as GitHub Actions files, since `uses:` can't be dynamic
  ([`docs/adr/0007-plugin-architecture.md`](adr/0007-plugin-architecture.md)).
- **Hooks** (`docs/hooks.md`) generalize the migration/reset/seed mechanism to twelve lifecycle
  points; `run-database-command` was renamed `run-remote-command` to match
  ([`docs/adr/0009-hooks.md`](adr/0009-hooks.md)).
- **Release manifest** (`docs/release-manifest.md`) is the source of truth the summary renders
  from ([`docs/adr/0010-release-manifest.md`](adr/0010-release-manifest.md)).

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
