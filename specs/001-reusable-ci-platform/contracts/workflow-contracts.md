# Workflow Contracts (Phase 1 design source; `docs/caller-contract.md` is the maintained copy)

## `docker-build.yml`

**Inputs**: `image_name` (string, required), `dockerfile` (string, default `Dockerfile`),
`context` (string, default `.`), `build_args` (string, JSON object of non-secret args, default
`{}`), `version_file` (string, default `./package.json` — preserves the exact current behavior
for existing callers; pass e.g. `backend/package.json` for a monorepo subfolder, or `""` to
disable version-tag extraction entirely; if the resolved path doesn't exist, extraction is
silently skipped rather than failing the build), `default_branch` (string, default `main`) —
`latest`/floating tags only push when `github.ref_name == inputs.default_branch`. Backward
compatible with `CoGuide_PPS_BackEnd`/`Conecta_SLA`'s current `v1.5` usage (see
`analysis-report.md` Finding 2).

**Secrets**: none required (`GITHUB_TOKEN` covers GHCR auth for the caller's own images).

**Outputs**: `image` (full `ghcr.io/...` name), `tag` (`sha-<short>`), `digest`.

**Permissions**: `contents: read`, `packages: write`.

## `deploy-stack.yml`

**Inputs**: `project_name`, `environment_name` (both required, validated by `resolve-project`),
`deploy_path` (optional override), `configuration_file` (default
`.github/deploy/<environment_name>.yml`), `image_refs` (string, JSON map of `imageId -> "name@tag"`
produced by the caller from one or more `docker-build.yml` calls), `reset_database` (boolean,
default `false`), `run_seeders` (boolean, default `false`), `use_tailscale` (boolean, default
`true`), `health_url_override` (string, default `""`).

**Secrets** (all declared, all optional at the schema level but runtime-validated as required
when the corresponding feature is enabled — see `docs/adr/0002-secrets-strategy.md`):
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `GHCR_PAT`, `TS_OAUTH_CLIENT_ID`,
`TS_OAUTH_SECRET`, `POSTGRES_PASSWORD`, plus six generic positional slots `ENV_FILE_1` ..
`ENV_FILE_6` — the *i*-th slot supplies the contents for the *i*-th entry of the config's
`environmentFiles` list. Callers use an **explicit `secrets:` map** (not `secrets: inherit`,
which cannot combine with per-slot renaming — see `analysis-report.md` Finding 1), renaming
their own human-named secrets onto these slots, e.g. `ENV_FILE_1: ${{ secrets.BACKEND_ENV_FILE }}`.

**Outputs**: `deployment_time_seconds`, `health_status`, `previous_image_refs` (JSON).

**Permissions**: `contents: read`, `packages: write`.

**Concurrency**: `group: deploy-${{ inputs.project_name }}-${{ inputs.environment_name }}`,
`cancel-in-progress: false`.

## `release.yml`

A net-new, more general workflow, additive alongside the existing `github-release.yml` (kept
unchanged for `CoGuide_PPS_BackEnd`/`CoGuide_PPS_FrontEnd`/`Conecta_SLA` — see
`analysis-report.md` Finding 2). New callers (Pricely, future projects) use `release.yml`.

**Inputs**: `ref`, `release_version`, `prerelease`, `version_file` (default `./package.json`,
same non-breaking default/skip-if-missing behavior as `docker-build.yml`).

**Secrets**: `DISCORD_WEBHOOK_URL` (optional).

**Outputs**: `tag`, `url`.

**Permissions**: `contents: write`.

## `validate-caller.yml`

**Inputs**: `project_name`, `environment_name`, `configuration_file`. Runs `resolve-project` +
`load-config` only, with no deploy side effects — usable as a required PR check so a caller
config mistake is caught before merge, not at deploy time.

**Secrets**: none.

**Outputs**: none (pass/fail only).

**Permissions**: `contents: read`.
