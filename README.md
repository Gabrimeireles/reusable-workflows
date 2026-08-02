# Reusable Workflows (Gabrimeireles)

A reusable CI/CD platform for personal GitHub projects: build & push any number of container
images (as a matrix — adding one is a config-only change), deploy a full Docker Compose stack
over SSH (with optional Tailscale, Postgres backup/migration/seed, 12 lifecycle hooks, and health
checks), cut GitHub releases with automatic version-tag management, and record every deploy as a
structured, rollback-ready manifest — all from one thin workflow file and one declarative config
file in the consumer repository. Stack-specific defaults (Postgres, Prisma, NestJS, Next.js,
Vite, ...) are available as [plugins](docs/plugins.md) so common setups need even less config.

`Gabrimeireles/Pricely` is the reference implementation and first consumer. See
[`docs/migration-pricely.md`](docs/migration-pricely.md) for how it adopted this platform.

## Why this exists

Before this rewrite, this repository only built images; every consumer re-implemented Tailscale,
SSH, GHCR auth, file upload, backup, migration, and health checks itself. That duplication (and
the risk of each copy drifting) is exactly what this platform removes — see
[`docs/architecture.md`](docs/architecture.md) for the full before/after picture and
[`specs/001-reusable-ci-platform/`](specs/001-reusable-ci-platform/) for the spec-driven process
(constitution, spec, clarifications, plan, tasks, analysis) that produced this design.

## Architecture

```
.github/
├── workflows/            # Orchestration only (job graphs, needs:, if: gating)
│   ├── ci.yml                 # Lints/tests this repo itself
│   ├── ci-cd.yml              # ★ Recommended entry point: build matrix (any N images) + deploy
│   ├── docker-build.yml       # Build + push one image (monorepo-aware); called by ci-cd.yml's matrix, or directly
│   ├── deploy-stack.yml       # Full deploy: network, SSH, upload, backup, migrate, hooks, health-check, manifest
│   ├── release.yml            # Tag + GitHub Release + automatic floating-major-tag move
│   ├── validate-caller.yml    # Config-only validation (no deploy), for PR checks
│   ├── docker-deploy-ssh.yml  # Legacy — kept for existing consumers, do not use for new projects
│   ├── github-release.yml     # Legacy — kept for existing consumers, do not use for new projects
│   └── swagger-pages.yml      # Swagger docs -> GitHub Pages
├── actions/               # One concern each, independently unit-tested
│   ├── resolve-project/       # Validate names, compute + validate the remote deploy path
│   ├── load-config/           # Resolve plugins, then schema+semantic-validate the deploy config
│   ├── setup-network/         # Optional Tailscale connection
│   ├── setup-ssh/             # ssh-agent + known_hosts pinning
│   ├── prepare-deploy-files/  # Render compose + env files into a private temp dir (+ checksums)
│   ├── upload-deploy-files/   # scp to the server, shred the local temp copy
│   ├── deploy-compose/        # Remote lifecycle: snapshot / start / recreate / cleanup
│   ├── backup-postgres/       # Wait-for-ready, pg_dump, verify, retention
│   ├── run-remote-command/    # Generic migration/reset/seed/hook runner
│   ├── health-check/          # HTTP or in-service command checks, with attempt counts
│   ├── release-manifest/      # Assembles release-manifest.json (the source of truth)
│   └── deployment-summary/    # Renders $GITHUB_STEP_SUMMARY from the manifest
├── plugins/               # postgres, redis, prisma, nestjs, nextjs, vite (docs/plugins.md)
├── schema/                # deploy-config.schema.json, release-manifest.schema.json
└── scripts/                # validate-config.mjs, plugin-loader.mjs, lint-composite-actions.sh
```

New projects use **`ci-cd.yml`** as their single entry point (or `docker-build.yml` +
`deploy-stack.yml` directly for more control), plus `release.yml` and optionally
`validate-caller.yml`. The three "legacy" workflows exist solely because
`CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, and `Conecta_SLA` are pinned to them today
(discovered via `gh search code` during the redesign — see
[`specs/001-reusable-ci-platform/analysis-report.md`](specs/001-reusable-ci-platform/analysis-report.md)
Finding 2); they are not deprecated on any timeline yet, just superseded for new adoption.

## Minimal caller example

```yaml
name: Deploy Homolog

on:
  push:
    branches: [master]
  workflow_dispatch:
    inputs:
      reset_database:
        type: boolean
        default: false
      run_seeders:
        type: boolean
        default: true

permissions:
  contents: read
  packages: write

concurrency:
  group: deploy-homolog-${{ github.ref }}
  cancel-in-progress: false

jobs:
  deploy:
    uses: Gabrimeireles/reusable-workflows/.github/workflows/ci-cd.yml@v1
    with:
      project_name: myapp
      environment_name: homolog
      reset_database: ${{ inputs.reset_database || false }}
      run_seeders: ${{ inputs.run_seeders || false }}
    secrets:
      DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
      DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
      DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
      GHCR_PAT: ${{ secrets.GHCR_PAT }}
      TS_OAUTH_CLIENT_ID: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      TS_OAUTH_SECRET: ${{ secrets.TS_OAUTH_SECRET }}
      COMPOSE_ENV_EXTRA: ${{ secrets.COMPOSE_ENV_EXTRA }}
      ENV_FILE_1: ${{ secrets.BACKEND_ENV_FILE }}
      ENV_FILE_2: ${{ secrets.WEB_ENV_FILE }}
```

Every project-specific detail — images (any number — adding a fourth is a config-only change),
Compose file, database, health checks, plugins, hooks — lives in `.github/deploy/homolog.yml` in
the **consumer** repository, nowhere else. That's the whole caller footprint: this workflow file
plus that one config file. Full walkthrough: [`docs/adding-a-project.md`](docs/adding-a-project.md).
Full contract (every input/secret/output): [`docs/caller-contract.md`](docs/caller-contract.md).

## Security model

- Secrets are **never** stored in this repository — see
  [`docs/secrets-and-environments.md`](docs/secrets-and-environments.md) for why `secrets:
  inherit` cannot combine with the positional environment-file secrets, and why callers use an
  explicit `secrets:` map instead.
- Every shell step runs under `set -euo pipefail`; secret-bearing temp files are written with
  `umask 177` and deleted in the same job.
- SSH host keys are pinned via `ssh-keyscan` into a job-scoped `known_hosts` — no
  `StrictHostKeyChecking=no`.
- Project/service/path inputs are validated against strict allow-list patterns before being used
  in any shell command or file path; deploy paths must resolve under `/srv/stacks`.
- Database reset is impossible to trigger from a `push` — it requires `workflow_dispatch` and is
  hard-blocked otherwise, regardless of what a caller passes.
- Third-party actions outside `actions/*`/`docker/*` are pinned to a commit SHA with a version
  comment; Dependabot opens update PRs weekly.

## Versioning

Semantic tags (`v1.2.3`) plus a floating `v1` a maintainer moves explicitly after each release.
Production-critical callers should pin a concrete `vX.Y.Z`, not `v1` and never a bare commit SHA
without a documented reason. See
[`docs/adr/0004-versioning-strategy.md`](docs/adr/0004-versioning-strategy.md).

## Documentation index

- [`docs/architecture.md`](docs/architecture.md) — full design, before/after, file-by-file rationale
- [`docs/secrets-and-environments.md`](docs/secrets-and-environments.md) — secrets strategy, personal account vs. organization
- [`docs/caller-contract.md`](docs/caller-contract.md) — every input, secret, and output, per workflow
- [`docs/adding-a-project.md`](docs/adding-a-project.md) — adopt the platform for a new project
- [`docs/migration-pricely.md`](docs/migration-pricely.md) — Pricely's before/after migration record
- [`docs/rollback.md`](docs/rollback.md) — manual rollback procedure
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common failures and fixes
- [`docs/plugins.md`](docs/plugins.md) / [`docs/adding-a-plugin.md`](docs/adding-a-plugin.md) — the plugin system and how to write one
- [`docs/hooks.md`](docs/hooks.md) — the 12 lifecycle hooks
- [`docs/release-manifest.md`](docs/release-manifest.md) — the structured record of every deploy
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`CHANGELOG.md`](CHANGELOG.md) — release history

## Development

```sh
make bootstrap   # check/report local tool availability (uv, node, actionlint, shellcheck, yamllint, yq, jq, bats, gh, docker)
make lint        # actionlint + shellcheck (workflows and composite actions) + yamllint
make test        # node --test (config validator) + bats (composite action logic)
make validate    # lint + test, the same gate CI runs
make spec        # list the Spec Kit commands available via .claude/skills
```

This repository was built using [GitHub Spec Kit](https://github.com/github/spec-kit)'s
spec-driven process; see [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
for the governing principles, [`specs/001-reusable-ci-platform/`](specs/001-reusable-ci-platform/)
for the original platform's spec/plan/tasks/analysis trail, and
[`specs/002-platform-maturity/`](specs/002-platform-maturity/) for the matrix/plugins/hooks/
manifest iteration (including its own critical architecture analysis, done before any code
changed).

## Known limitations

- Environment files are capped at 6 per deploy (`ENV_FILE_1`..`ENV_FILE_6`), positionally mapped
  to the declarative config's `environmentFiles` list — a GitHub Actions constraint, not a design
  preference (see `docs/adr/0002-secrets-strategy.md`).
- Health checks are capped at 4 per deploy, kept as simple inline steps rather than a matrix —
  a deliberate scope decision (a matrix would need the same artifact fan-in complexity as image
  builds, for no real benefit at the 1-2-checks-per-project scale this platform targets today;
  see `specs/002-platform-maturity/clarify-log.md` Q2).
- Images built in one deploy must share a single immutable tag (all built from the same commit).
- Rollback is manual only — see [`docs/rollback.md`](docs/rollback.md) and
  [`docs/adr/0006-rollback-strategy.md`](docs/adr/0006-rollback-strategy.md) for why.
- Only Postgres is supported as a database engine for now — the schema, `backup-postgres`, and
  the shipped `postgres` plugin are all Postgres-specific; a planned `mysql` plugin was dropped
  rather than shipped non-functional (see `docs/plugins.md`).
- Ports are not modeled in the declarative config (they live in your Compose file / the
  `COMPOSE_ENV_EXTRA` secret), so duplicate-port validation is out of scope.
- Self-hosted runners are untested; the platform assumes GitHub-hosted `ubuntu-latest` runners.
