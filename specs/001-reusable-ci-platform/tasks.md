# Tasks: Reusable CI/CD Platform for Personal Projects

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `clarify-log.md`

**Tests**: Explicitly requested by the feature (FR-050/FR-051, Constitution Quality Gates) —
included as first-class tasks, not optional.

**Organization**: Grouped by user story per `spec.md`, after a Setup/Foundational phase shared
by all stories (the composite actions and scripts every story's workflow calls into).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Install & configure GitHub Spec Kit; ratify `constitution.md` (done pre-planning)
- [ ] T002 [P] `Makefile` with `bootstrap`, `lint`, `test`, `validate`, `spec` targets
- [ ] T003 [P] `scripts/bootstrap.sh` — idempotent installer/checker for uv, Node, actionlint,
      shellcheck, yamllint, yq, jq, bats-core, gh, docker, act (optional)
- [ ] T004 [P] `.github/dependabot.yml` for GitHub Actions updates (weekly)
- [ ] T005 [P] `.github/workflows/ci.yml` skeleton (actionlint + shellcheck + yamllint jobs, no
      tests yet — tests wired in as they're written per story)

**Checkpoint**: `make bootstrap && make lint` runs (even with nothing to lint yet beyond the
existing 4 legacy workflows).

## Phase 2: Foundational (blocks all user stories)

**Purpose**: The shared composite actions/config machinery every story's workflow depends on.

- [ ] T010 [P] `.github/actions/resolve-project/action.yml` — validate `project_name` /
      `environment_name` against `^[a-z][a-z0-9-]{1,48}$`, compute `deploy_path` (default
      `/srv/stacks/<project_name>`), reject any path not under `/srv/stacks` or containing `..`
- [ ] T011 [P] `specs/001-reusable-ci-platform/contracts/config.schema.json` finalize (done in
      plan phase; re-verify against T012's fixtures)
- [ ] T012 [P] `.github/scripts/validate-config.mjs` — Node validator matching the schema;
      `.github/actions/load-config/action.yml` wraps it (yq YAML→JSON, then node script)
- [ ] T013 [P] `tests/fixtures/config/valid/{single-image,multi-image,no-database,pricely-homolog}.yml`
- [ ] T014 [P] `tests/fixtures/config/invalid/{path-traversal,bad-project-name,missing-migration-command,bad-health-check}.yml`
- [ ] T015 [US-shared] `tests/unit/validate-config.test.mjs` (Node `node:test`) — every valid
      fixture passes, every invalid fixture fails with the expected reason
- [ ] T016 [P] `.github/actions/setup-network/action.yml` (Tailscale, `if: inputs.enabled`)
- [ ] T017 [P] `.github/actions/setup-ssh/action.yml` (ssh-agent + retried `ssh-keyscan` into a
      job-scoped `known_hosts`)
- [ ] T018 [P] `.github/actions/deployment-summary/action.yml` (writes `$GITHUB_STEP_SUMMARY`
      from passed-in inputs; also emits step outputs mirroring the same data)

**Checkpoint**: `load-config` correctly parses/validates all fixtures in isolation (Bats/node
test), independent of any real workflow run.

## Phase 3: User Story 1 — Build one or many images (Priority: P1) 🎯 MVP

**Goal**: `docker-build.yml` builds N images from a monorepo without a root `package.json`.

**Independent Test**: per `spec.md` US1.

- [ ] T020 [P] [US1] `tests/bats/docker-build-tags.bats` — pure-shell unit test of the tag/owner
      computation logic extracted into `.github/scripts/lib/image-tags.sh` (so it's testable
      without invoking Buildx)
- [ ] T021 [US1] `.github/scripts/lib/image-tags.sh` — owner lowercasing, SHA tag, floating-tag
      gate by branch (extracted from current `docker-build.yml` logic)
- [ ] T022 [US1] Edit (not rewrite) `.github/workflows/docker-build.yml`: add `version_file`
      input defaulting to `./package.json` (byte-identical current behavior for existing
      `CoGuide_PPS_BackEnd`/`Conecta_SLA` callers pinned to `v1.5`), skip version-tag extraction
      when the resolved path doesn't exist instead of failing, allow `""` to disable it
      explicitly; keep `image_name`/`dockerfile`/`context` unchanged; add `build_args` (JSON
      object → `docker/build-push-action` `build-args`); keep PR no-push behavior; add explicit
      `permissions:` if missing. Ship as a `v1` minor release (non-breaking) — see
      `analysis-report.md` Finding 2.
- [ ] T023 [US1] Wire `docker-build.yml`'s lint/shellcheck into `ci.yml`

**Checkpoint**: `docker-build.yml` builds a fixture project with 2 images, neither with a root
`package.json`, and produces immutable SHA tags. (Validated via `actionlint`/`shellcheck` +
manual dry run against a scratch repo before Pricely migration, since GHCR push itself can't be
exercised in this repo's own CI per Principle X.)

---

## Phase 4: User Story 2 — Thin deploy caller for a full stack (Priority: P1)

**Goal**: `deploy-stack.yml` reproduces every current Pricely deploy behavior generically.

**Independent Test**: per `spec.md` US2; validated concretely during the Pricely migration
(`docs/migration-pricely.md` equivalence check).

- [ ] T030 [P] [US2] `.github/actions/prepare-deploy-files/action.yml` — render compose
      destination + up to 6 positional env files (inputs `env_file_1_contents` ..
      `env_file_6_contents`, matched to `load-config`'s parsed `environmentFiles[].destination`/
      `.required` by index — see ADR 0002/`analysis-report.md` Finding 1) into a `mktemp -d`
      0700 dir, `umask 177` before each write
- [ ] T031 [P] [US2] `.github/actions/upload-deploy-files/action.yml` — `scp` the temp dir
      contents to `deploy_path`, then `rm -rf` the local temp dir unconditionally (`if: always()`)
- [ ] T032 [US2] `.github/actions/deploy-compose/action.yml` (remote steps over `ssh`, command
      passed via heredoc with values injected through `env:` on the SSH invocation, not string
      interpolation): `mkdir -p`, snapshot current `.env`/compose to `.previous`, GHCR login,
      `pull`, `up -d` dependency services
- [ ] T033 [P] [US2] `.github/actions/backup-postgres/action.yml` — wait-for-ready loop,
      `pg_dump --format=custom --no-owner`, `pg_restore --list` verify, retention `-mtime
      +N -delete`, never deletes the just-taken backup
- [ ] T034 [P] [US2] `.github/actions/run-database-command/action.yml` — generic
      migration/reset/seed runner (ADR 0005): `command` + `service` inputs, `docker compose
      run --rm -T <service> sh -lc "$COMMAND"` with `COMMAND` passed via `env:`
- [ ] T035 [P] [US2] `.github/actions/health-check/action.yml` — `type: http | compose`, retry
      loop, prints `docker compose logs --tail` for the affected service on failure
- [ ] T036 [US2] `.github/workflows/deploy-stack.yml` — orchestrates T010/T012/T016/T017/T030-
      T035/T018 in one `deploy` job plus a `reset-guard` step (Principle VII / FR-030) that hard-
      fails if `reset_database == true` and `github.event_name != 'workflow_dispatch'`; sets
      `concurrency: group: deploy-${{ inputs.project_name }}-${{ inputs.environment_name }}`;
      declares `on.workflow_call.secrets`: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
      `GHCR_PAT`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `POSTGRES_PASSWORD`, `ENV_FILE_1`..
      `ENV_FILE_6` (all `required: false`, runtime-validated conditionally — ADR 0002)
- [ ] T037 [US2] `tests/bats/reset-guard.bats` — asserts the guard script fails on
      `push`+`reset=true` and passes on `workflow_dispatch`+`reset=true`
- [ ] T038 [US2] `tests/bats/backup-postgres.bats` — against a throwaway local Postgres
      container (Principle X): backup+verify succeeds, retention deletes only old files
- [ ] T039 [US2] `tests/bats/deploy-compose.bats` — against a throwaway local `sshd` container:
      upload + remote command sequencing, `.env.previous` snapshot behavior
- [ ] T040 [US2] `tests/bats/secret-exposure.bats` — greps every workflow/action source for
      secret-leak patterns (Principle III / FR-051)

**Checkpoint**: All Phase 4 Bats suites pass locally without any real SSH/Postgres/Tailscale
access, satisfying Principle X before this is ever pointed at Pricely's real server.

---

## Phase 5: User Story 3 — Add a new project without touching this repo (Priority: P2)

**Goal**: A second, non-Pricely project can adopt the platform using only docs + config.

- [ ] T050 [P] [US3] `.github/workflows/validate-caller.yml` (calls `resolve-project` +
      `load-config` only; usable as a required PR check)
- [ ] T051 [US3] `docs/adding-a-project.md` — step-by-step, cross-checked against `quickstart.md`
- [ ] T052 [US3] `tests/fixtures/config/valid/no-database.yml` exercised end-to-end through
      `validate-caller.yml`'s logic in a Bats test (`tests/bats/validate-caller.bats`)

**Checkpoint**: SC-002 — a maintainer can follow `docs/adding-a-project.md` without reading
`.github/actions` source.

---

## Phase 6: User Story 4 — Destructive operations are always explicit (Priority: P1)

**Goal**: Reset is structurally unreachable outside `workflow_dispatch`.

*(Implementation is T036's `reset-guard` step + T037's test; this phase is the documentation and
environment-gating layer on top.)*

- [ ] T060 [US4] `docs/rollback.md` including the reset/backup interaction and the manual
      rollback procedure (ADR 0006)
- [ ] T061 [US4] Document the optional `environment:`-gated reset pattern (research.md R4) in
      `docs/caller-contract.md` and `docs/adding-a-project.md`

**Checkpoint**: SC-003 — negative tests (T037) prove 0 push-triggered runs can reach the reset
command.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T070 [P] `.github/workflows/release.yml` — NEW, additive workflow (copy of
      `github-release.yml`'s logic with the `version_file` input from T022); `github-release.yml`
      itself is left unchanged for its existing consumers (`analysis-report.md` Finding 2)
- [ ] T071 [P] Pin every third-party (non-`actions/*`/`docker/*`) `uses:` across all workflows
      and actions to a full commit SHA with a version comment (Principle XIII)
- [ ] T072 [P] Add explicit `permissions:` to every workflow that's missing one
      (`swagger-pages.yml` audit) (Principle XIV) — additive only, no behavior change, given
      `CoGuide_PPS_BackEnd`/`CoGuide_PPS_FrontEnd`/`Conecta_SLA` pin these files
- [ ] T072a [P] Manually verify (no code change expected) that `CoGuide_PPS_BackEnd`,
      `CoGuide_PPS_FrontEnd`, and `Conecta_SLA` still resolve correctly at their pinned
      `v1.5`/`v1.7`/`v1.8` tags after T022/T071/T072 (those tags are immutable refs to old
      commits and are never rewritten, so this is a sanity check, not a migration)
- [ ] T073 `README.md` full rewrite (purpose, architecture, workflows, actions, quickstart,
      security model, versioning, troubleshooting)
- [ ] T074 [P] `docs/architecture.md`
- [ ] T075 [P] `docs/secrets-and-environments.md` (expand ADR 0002 into the full walkthrough)
- [ ] T076 [P] `docs/caller-contract.md` (generated from `contracts/workflow-contracts.md`)
- [ ] T077 [P] `docs/troubleshooting.md`
- [ ] T078 `CHANGELOG.md` (Keep a Changelog format) seeded with the `v1.0.0` entry for this
      rewrite
- [ ] T079 Grep-based test (`tests/bats/no-project-literals.bats`) enforcing Principle VIII —
      fails if `.github/workflows` or `.github/actions` contain `pricely`/`prisma`/etc. outside
      comments referencing docs
- [ ] T080 `make validate` wires actionlint + shellcheck + yamllint + all Bats suites + the Node
      config-validator test into one command; wire the same into `ci.yml`
- [ ] T081 Run `/speckit-analyze`-equivalent cross-check (separate task, see project task #10)
- [ ] T082 `docs/migration-pricely.md` (before/after table, secrets/variables split, rollback
      plan for the migration itself) — see project task #14

## Dependencies & Execution Order

- Phase 1 (Setup) → Phase 2 (Foundational) → Phases 3–6 (user stories, mostly parallel-safe
  since each touches distinct action directories) → Phase 7 (Polish, depends on all workflows
  existing).
- Within Phase 4, T030–T035 are parallel-safe (different action directories); T036 depends on
  all of them plus T010/T012/T016–T018 from Phase 2.
- T071 (pin SHAs) and T072 (permissions audit) should run last among code changes, once no more
  new `uses:` lines are being added, to avoid re-pinning churn.

## Implementation Strategy

MVP = Phase 1 + 2 + Phase 3 (build) + Phase 4 (deploy) — this alone reproduces Pricely's full
current behavior generically and is independently deployable/testable. Phases 5–6 generalize and
harden; Phase 7 documents and finishes the quality gates.
