# Implementation Plan: Reusable CI/CD Platform for Personal Projects

**Branch**: `speckit/reusable-ci-platform` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-reusable-ci-platform/spec.md`, resolved
clarifications from `specs/001-reusable-ci-platform/clarify-log.md`.

## Summary

Replace the current four flat, partially-generic reusable workflows with a modular platform:
a small set of orchestrating reusable workflows plus a library of composite actions that each
own one concern (network, SSH, config loading, upload, backup, DB command, health check,
summary). Consumers (starting with Pricely) call `deploy-stack.yml` with a handful of scalar
inputs plus an optional declarative YAML config file for the list/nested data (images, health
checks, database, env files). Every infrastructure secret is declared, by name, on the
workflow's `on.workflow_call.secrets` contract and validated at runtime, while callers use
`secrets: inherit` for now (personal-account, single-trusted-caller reality — see
`docs/adr/0002-secrets-strategy.md`). Destructive DB operations are structurally blocked outside
`workflow_dispatch`. Rollback is manual-only, supported by preserved previous-state artifacts.

## Technical Context

**Language/Version**: GitHub Actions YAML (workflow + composite action syntax); POSIX-ish Bash
(`bash`, running under `set -euo pipefail`) for all embedded and standalone scripts; a small
amount of Node.js (already present on `ubuntu-latest` runners) for the declarative-config
validator, chosen over adding a Python/pip or npm-install dependency to keep the toolchain
minimal.

**Primary Dependencies**: `actions/checkout`, `docker/setup-buildx-action`,
`docker/login-action`, `docker/metadata-action`, `docker/build-push-action`,
`tailscale/github-action`, `webfactory/ssh-agent`, `actions/github-script` (release tagging),
`rhysd/actionlint` (via container in CI), `shellcheck` (apt package), `yamllint` (pip package),
`yq`/`jq` (declarative config parsing), Bats (`bats-core`, shell test framework) for composite
action / script unit tests.

**Storage**: N/A for this repository itself. The platform operates against a remote host's
Docker Compose state and, when a project enables it, a PostgreSQL container on that host.

**Testing**: `actionlint` (workflow static analysis), `shellcheck` (all `run:` blocks extracted
+ standalone scripts), `yamllint` (YAML style/correctness), a hand-written Node validator tested
against `tests/fixtures/config/{valid,invalid}/*.yml`, and `bats-core` specs for every
composite action's shell logic using Docker-based local mocks (a throwaway `sshd` container and
a throwaway Postgres container) — never the real Pricely server.

**Target Platform**: GitHub-hosted `ubuntu-latest` runners calling out (via Tailscale/SSH) to a
Linux host running Docker + Docker Compose v2. Self-hosted runners are out of scope (per
`spec.md` Assumptions).

**Project Type**: Reusable GitHub Actions workflow library (not an application). "Source" is
`.github/workflows/*.yml` + `.github/actions/*/action.yml` + their embedded/extracted shell.

**Performance Goals**: N/A in the traditional sense; the practical goal is a full Pricely-shaped
deploy (2 images, Postgres backup+migrate+seed, 2 health checks) completing in roughly the same
wall-clock time as today's workflow (no added round trips beyond what correctness requires).

**Constraints**: Must run entirely on GitHub-hosted runners with no self-hosted infrastructure;
must not require the reusable-workflows repository to hold any secret; must keep a caller
workflow for a Pricely-shaped project under ~100 lines (SC-001).

**Scale/Scope**: One organization-of-one maintainer, currently 1 real consumer (Pricely) and an
unknown small number of future personal projects (single-digit to low tens, not a multi-team
platform).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design below.*

| Principle | Check | Result |
|---|---|---|
| I. Minimal, declarative callers | Design moves all Tailscale/SSH/GHCR/backup/DB/health logic into this repo's workflows+actions; caller only supplies inputs/config/secrets | PASS |
| II. Security by default | `set -euo pipefail`, `umask 177` for secret files, pinned `known_hosts`, `env:`-passed values (Phase 1 detail) | PASS (verified per-action in Phase 1) |
| III. No secret exposure | No design step writes a secret to `$GITHUB_OUTPUT`/summary; grep-based test planned (FR-051 test suite) | PASS |
| IV. Backward compatibility within major | Versioning strategy (ADR 0004) defines `v1` floating tag + immutable tags + CHANGELOG | PASS |
| V. Immutable image tags | `docker-build.yml` outputs SHA tag; `deploy-stack.yml` only accepts/uses SHA tags for deploy | PASS |
| VI. Idempotent deploy | `docker compose up -d`, `mkdir -p`, caller-owned migration idempotency documented as a caller responsibility | PASS |
| VII. Explicit destructive ops | `resolve-project`/`deploy-stack.yml` hard-fail reset on non-`workflow_dispatch` events (FR-030) | PASS |
| VIII. Central workflows generic | No project literals in `.github/workflows|actions`; Pricely values only in `tests/fixtures` and docs examples | PASS (enforced by a grep-based test in Phase 2) |
| IX. Project config stays local | `load-config` action reads caller-owned YAML; nothing project-specific is defaulted centrally | PASS |
| X. Tests without prod dependency | `ci.yml` uses local Docker mocks only (Phase 1 `research.md`) | PASS |
| XI. Observability | `deployment-summary` action is mandatory in `deploy-stack.yml`'s job graph (`if: always()`) | PASS |
| XII. Docs part of delivery | Same PR updates `docs/caller-contract.md` (tracked as explicit tasks in `tasks.md`) | PASS |
| XIII. Pin external actions | Phase 2 task pins every non-`actions/*`/`docker/*` `uses:` to a commit SHA | PASS (tracked, not yet executed at plan time) |
| XIV. Least privilege | Every new/changed workflow declares an explicit `permissions:` block | PASS |
| XV. No project as global rule | Pricely's 2-image/Postgres+Redis+pgAdmin/2-health-check shape expressed entirely as config in `specs/.../contracts` and `Pricely`'s own config file | PASS |

No violations requiring a Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/001-reusable-ci-platform/
├── spec.md                # Feature specification (/speckit-specify)
├── clarify-log.md         # Resolved clarifications (/speckit-clarify)
├── checklists/
│   └── requirements.md    # Spec quality checklist
├── plan.md                # This file (/speckit-plan)
├── research.md             # Phase 0 output
├── data-model.md          # Phase 1 output
├── quickstart.md          # Phase 1 output
├── contracts/
│   ├── config.schema.json # Declarative config file JSON Schema
│   └── workflow-contracts.md  # Inputs/outputs/secrets per reusable workflow
└── tasks.md                # Phase 2 output (/speckit-tasks, separate command)
```

### Source Code (repository root)

```text
.github/
├── workflows/
│   ├── ci.yml                 # Lints + tests this repo itself (actionlint/shellcheck/yamllint/bats)
│   ├── docker-build.yml       # Reusable: build + push N images (monorepo-aware)
│   ├── deploy-stack.yml       # Reusable: orchestrates the full deploy (calls composite actions below)
│   ├── release.yml            # Reusable: tag + GitHub Release (generalized from github-release.yml)
│   ├── validate-caller.yml    # Reusable: standalone config/input validation (usable on PRs, and internally by deploy-stack.yml)
│   └── swagger-pages.yml      # Kept, lightly hardened (permissions/pinning only — out of this feature's core scope)
├── actions/
│   ├── resolve-project/           # Validates project/environment names, computes & validates deploy_path
│   ├── load-config/                # Parses + validates the declarative YAML config against contracts/config.schema.json
│   ├── setup-network/              # Optional Tailscale connection
│   ├── setup-ssh/                  # ssh-agent + known_hosts (with retry)
│   ├── prepare-deploy-files/        # Renders compose file + env files into a 0700 temp dir with umask 177
│   ├── upload-deploy-files/         # scp's the temp dir to the remote deploy_path, then shreds the local copy
│   ├── deploy-compose/              # Remote: mkdir, snapshot previous state, GHCR login, pull, start deps, recreate services, prune
│   ├── backup-postgres/             # Remote: wait-for-ready, pg_dump, pg_restore --list verify, retention cleanup
│   ├── run-database-command/        # Remote: runs a caller-supplied migration/reset/seed command inside a named service
│   ├── health-check/                # HTTP and/or in-service command checks with retry/interval, logs on failure
│   └── deployment-summary/          # Writes $GITHUB_STEP_SUMMARY from prior job/step outputs
├── scripts/
│   ├── validate-config.mjs         # Node validator used by load-config (no runtime npm install)
│   └── lib/…                       # Shared shell helpers (name/path validation regexes, etc.)
└── dependabot.yml                  # Weekly update PRs for pinned actions

tests/
├── fixtures/
│   ├── config/{valid,invalid}/*.yml      # Declarative config fixtures (incl. path traversal, bad names)
│   └── compose/*.yml                     # Minimal compose files for local action tests
├── bats/                                  # bats-core specs, one file per composite action + shared script
└── unit/validate-config.test.mjs          # Node test for the config validator

docs/
├── architecture.md
├── secrets-and-environments.md
├── caller-contract.md
├── migration-pricely.md
├── adding-a-project.md
├── rollback.md
├── troubleshooting.md
└── adr/
    ├── 0001-reusable-workflows-vs-composite-actions.md
    ├── 0002-secrets-strategy.md
    ├── 0003-config-model.md
    ├── 0004-versioning-strategy.md
    ├── 0005-project-specific-commands.md
    └── 0006-rollback-strategy.md

scripts/bootstrap.sh   # Idempotent local dev tool installer
Makefile               # bootstrap / lint / test / validate / spec targets
```

**Structure Decision**: Reusable workflows are kept thin orchestrators (job graph + `needs:` +
`if:` gating); almost all actual shell logic lives in composite actions under `.github/actions/`
so it is independently unit-testable with Bats and independently reusable if a future workflow
needs only part of the sequence (e.g. `validate-caller.yml` reuses `resolve-project` and
`load-config` without pulling in deploy logic). This directly implements
`docs/adr/0001-reusable-workflows-vs-composite-actions.md`.

## Phase 0 — Research

See `research.md` for the full writeup. Key resolved unknowns:
- GitHub Actions secrets propagation rules for reusable workflows (confirmed live against
  current GitHub documentation, not assumed) — see `docs/secrets-and-environments.md`.
- Reusable workflow nesting limit (10 levels total) — not a binding constraint at our depth
  (`deploy-stack.yml` → composite actions is 1 level; composite actions cannot themselves call
  reusable workflows, so real depth is 1).
- `workflow_call` has no list/object input type — informs the hybrid config model (ADR 0003).
- A job's `environment:` in a *called* reusable workflow resolves against the environment
  configured in the repository that owns the workflow run context appropriately for
  `workflow_dispatch`/`push` — i.e. the caller repository's own Environments — which is what
  makes environment-gated destructive operations (Principle VII) actually enforceable per caller
  without any change needed in this repository.
- Verified real Pricely commands (do not assume): `npm run db:generate && npm run
  db:migrate:deploy:safe` (migration), `npm run db:generate && npm run db:migrate:reset` (reset),
  `npm run db:seed` (seed) — from `backend/package.json` and `backend/prisma/*.js`.

## Phase 1 — Design

- `data-model.md`: Project / Image definition / Environment / Database configuration / Health
  check / Deploy run record, matching `spec.md`'s Key Entities, expressed concretely as the
  declarative config's shape.
- `contracts/config.schema.json`: JSON Schema for the declarative config file (validated by
  `.github/scripts/validate-config.mjs`, and used for editor autocompletion via a
  `# yaml-language-server: $schema=` hint in the example file).
- `contracts/workflow-contracts.md`: the exact `inputs`/`secrets`/`outputs` for
  `docker-build.yml`, `deploy-stack.yml`, `release.yml`, `validate-caller.yml` — the source of
  truth `docs/caller-contract.md` is generated from during implementation.
- `quickstart.md`: the shortest path from zero to a first deploy for a brand-new project,
  matching `docs/adding-a-project.md`'s intent (kept in sync during implementation).

## Constitution Check (post-design)

Re-checked against the concrete file list and contracts above: no new violations introduced by
Phase 1 design. `load-config`'s Node dependency is the one addition not in the original
composite-action name list the brief suggested; it is justified because `workflow_call` cannot
express nested config natively (see `docs/adr/0003-config-model.md`) and a hand-written ~150
line validator was chosen over adding `ajv`/`jsonschema` as a dependency, keeping Principle
"no overengineering" intact while still satisfying FR-041/FR-051's negative-test requirements.

## Complexity Tracking

No Constitution Check violations required justification.
