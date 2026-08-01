# Workflow Contracts (Phase 1 design source; `docs/caller-contract.md` is the maintained copy)

## `docker-build.yml`

**Inputs**: `image_name` (string, required), `dockerfile` (string, default `Dockerfile`),
`context` (string, default `.`), `build_args` (string, JSON object of non-secret args, default
`{}`), `version_file` (string, default `""` — when empty, no version is extracted; when set,
must point at a `package.json` reachable from the repo root), `default_branch` (string, default
`main`) — `latest`/floating tags only push when `github.ref_name == inputs.default_branch`.

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
when the corresponding feature is enabled): `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
`GHCR_PAT`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, plus one secret per `environmentFiles`
entry named in the configuration file (looked up dynamically via `secrets[...]` is not possible
in Actions, so the caller passes them through a `secrets:` map keyed identically to the config's
`secret` fields — see `docs/caller-contract.md` for the exact mechanics).

**Outputs**: `deployment_time_seconds`, `health_status`, `previous_image_refs` (JSON).

**Permissions**: `contents: read`, `packages: write`.

**Concurrency**: `group: deploy-${{ inputs.project_name }}-${{ inputs.environment_name }}`,
`cancel-in-progress: false`.

## `release.yml`

**Inputs**: `ref`, `release_version`, `prerelease`, `version_file` (replaces the hardcoded
`./package.json` read — same fix as `docker-build.yml`).

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
