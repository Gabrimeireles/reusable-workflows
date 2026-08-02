# Caller Contract

The authoritative source is always the `on.workflow_call` block of each workflow file; this
document is a maintained, human-readable copy. If they disagree, the workflow file wins — please
open a PR fixing this doc.

## `docker-build.yml`

**Inputs**

| Name | Type | Default | Notes |
|---|---|---|---|
| `image_name` | string | *required* | Image name without registry, e.g. `myapp-backend` |
| `dockerfile` | string | `dockerfile` | Path to the Dockerfile |
| `context` | string | `.` | Build context |
| `node_version` | string | `24` | Node.js version used only for version extraction |
| `version_file` | string | `./package.json` | Path to extract a `vX.Y.Z` tag from. Pass `""` to disable version tagging, or a subfolder path (`backend/package.json`) for a monorepo image. A missing file is skipped, not an error — this default preserves the exact historical behavior for existing callers. |
| `build_args` | string (JSON object) | `{}` | Non-secret build args only; keys matching `SECRET`/`TOKEN`/`PASSWORD`/`KEY` are rejected |
| `default_branch` | string | `master` | Branch on which the floating `latest`/`vX.Y.Z` tags are pushed |
| `artifact_id` | string | `""` | Set only by `ci-cd.yml`'s matrix — when non-empty, uploads a workflow artifact (`image-<artifact_id>`, containing `{id, image, tag, digest, size}`) for the matrix fan-in. Standalone callers get no artifact and no behavior change. |
| `pre_build_command` / `post_build_command` | string | `""` | Resolved hook commands (`docs/hooks.md`), run on the runner before/after the build. Set only by `ci-cd.yml` — this workflow never resolves hooks itself. |

**Secrets**: none (uses the caller's own `GITHUB_TOKEN` for GHCR).

**Outputs**: `image` (full `ghcr.io/...` reference, no tag), `tag` (`sha-<short>`), `digest`,
`size` (bytes, best-effort), `version` (extracted version string, or empty).

## `ci-cd.yml` (recommended entry point for new projects)

**Inputs/secrets/outputs**: identical to `deploy-stack.yml` below, plus `default_branch`
(passed through to each matrix `docker-build.yml` call). No `image_refs` input — it builds every
image in the config's `images` list itself and computes `image_refs`/`image_details`
internally, via a matrix build + artifact-based collection
([`docs/adr/0008-build-matrix-fanin.md`](adr/0008-build-matrix-fanin.md)).

**Permissions**: `contents: read`, `packages: write`. **Concurrency**: same as `deploy-stack.yml`.

**Permissions**: `contents: read`, `packages: write`.

## `deploy-stack.yml`

**Inputs**

| Name | Type | Default | Notes |
|---|---|---|---|
| `project_name` | string | *required* | `^[a-z][a-z0-9-]{1,48}$` |
| `environment_name` | string | *required* | `^[a-z][a-z0-9-]{1,31}$` |
| `deploy_path` | string | `""` | Override; must resolve under `base_dir` |
| `base_dir` | string | `/srv/stacks` | Base directory every deploy path must live under |
| `configuration_file` | string | `""` (→ `.github/deploy/<environment_name>.yml`) | Declarative config path |
| `image_refs` | string (JSON) | *required* | `{"<imageId>":"<registry>/<name>:<tag>"}`; all images must share one tag |
| `reset_database` | boolean | `false` | Only honored on `workflow_dispatch`; hard-blocked otherwise |
| `run_seeders` | boolean | `false` | Runs the config's `database.seed.command` |
| `use_tailscale` | boolean | `true` | |
| `health_url_override` | string | `""` | Overrides the first `http`-type health check's URL |
| `image_details` | string (JSON) | `{}` | Optional `{"<imageId>":{"ref":...,"digest":...,"size":...}}`, populated by `ci-cd.yml`'s collect job, used only to enrich the release manifest |

**Secrets**

| Name | Required when |
|---|---|
| `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` | always |
| `GHCR_PAT` | always (remote GHCR login) |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | `use_tailscale: true` |
| `COMPOSE_ENV_EXTRA` | the Compose file references any variable the platform doesn't derive itself (almost always) |
| `ENV_FILE_1` .. `ENV_FILE_6` | the *i*-th `environmentFiles` config entry is `required: true` |

Callers use an **explicit `secrets:` map** (see [`docs/secrets-and-environments.md`](secrets-and-environments.md)),
not `secrets: inherit`.

**Outputs**: `health_status` (`success`/`failure`/`skipped`), `deployment_time_seconds`. Every
run also produces a `release-manifest.json` (server + workflow artifact) — see
[`docs/release-manifest.md`](release-manifest.md).

**Permissions**: `contents: read`, `packages: write`. **Concurrency**: one deploy at a time per
`project_name`+`environment_name`.

### Declarative config file

Validated against [`.github/schema/deploy-config.schema.json`](../.github/schema/deploy-config.schema.json).
See [`specs/001-reusable-ci-platform/data-model.md`](../specs/001-reusable-ci-platform/data-model.md)
for the full field reference, and `tests/fixtures/config/valid/pricely-homolog.yml` for a
complete real-world example. Summary:

```yaml
version: 1
project: { name: myapp, deployPath: /srv/stacks/myapp }   # deployPath optional
images:
  - { id: backend, name: myapp-backend, context: ./backend, dockerfile: ./backend/Dockerfile }
compose:
  source: docker-compose.homolog.yml
  destination: docker-compose.yml          # optional, default shown
  dependencyServices: [postgres]           # started before migration
  applicationServices: [backend]           # recreated after migration
environmentFiles:                          # up to 6, positional -> ENV_FILE_1..6
  - { secret: BACKEND_ENV_FILE, destination: .env.backend, required: true }
database:
  enabled: true
  engine: postgres
  composeService: postgres
  containerDatabase: myapp
  backup: { enabled: true, retentionDays: 14 }
  migration: { service: backend, command: "npm run migrate" }
  reset: { command: "npm run migrate:reset" }      # only needed if you'll ever request a reset
  seed: { command: "npm run seed" }                # only needed if you'll ever request a seed
healthChecks:                              # up to 4
  - { name: web, type: compose, service: web, command: "curl -f http://127.0.0.1:5173" }
  - { name: public, type: http, url: "https://myapp.example.com" }
plugins: [postgres, prisma]                # docs/plugins.md — optional
hooks:                                     # docs/hooks.md — optional, 12 fixed names
  post_deploy: "curl -X POST https://api.example.com/cache/purge"
```

Plugin-contributed defaults (e.g. `database.engine`, a `healthChecks` template) are applied
*before* the schema/semantic checks above run, so a project can rely entirely on
`plugins: [postgres]` for those fields instead of spelling them out.

## `release.yml`

**Inputs**: `ref` (default `""` → current ref), `release_version` (default `""` → extracted),
`version_file` (default `./package.json`), `prerelease` (default `false`), `update_major_tag`
(default `true` — force-moves the floating `vMAJOR` tag to the new commit after a non-prerelease
release, skipped with a warning if that would regress the tag; see
[`docs/adr/0004-versioning-strategy.md`](adr/0004-versioning-strategy.md)).

**Secrets**: `DISCORD_WEBHOOK_URL` (optional).

**Outputs**: `tag`, `url`. **Permissions**: `contents: write`.

## `validate-caller.yml`

Same `project_name`/`environment_name`/`deploy_path`/`base_dir`/`configuration_file` inputs as
`deploy-stack.yml`, no secrets, no outputs beyond pass/fail. Runs `resolve-project` +
`load-config` only — no SSH, no deploy. Intended as a required PR status check.

## Legacy workflows (do not use for new projects)

`docker-deploy-ssh.yml`, `github-release.yml`, and `swagger-pages.yml` keep their pre-existing
contracts unchanged, documented in their own files' `on.workflow_call` blocks. They exist only
because `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, and `Conecta_SLA` are pinned to them.
