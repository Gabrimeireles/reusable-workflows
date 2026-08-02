# Tasks: Platform Maturity (Iteration 2)

**Input**: `spec.md`, `plan.md`, `architecture-analysis.md`, ADRs 0007–0010, amended ADR 0004

**Tests**: Included as first-class tasks (Constitution Quality Gates, spec SC-003/SC-005/SC-006).

## Phase 1: Foundational (blocks all user stories)

- [ ] T100 [P] `.github/scripts/lib/plugin-loader.mjs` — `resolvePlugins(config, pluginsDir)`:
      dynamic `import()` per declared plugin name, deep-merge `defaults` (config wins, later
      plugin wins over earlier for anything still unset), collect `validate()` issues, fold in
      `hooks`/`healthChecks` defaults. Pure function, unit-testable without touching the CLI glue.
- [ ] T101 [P] Extend `.github/schema/deploy-config.schema.json`: add `plugins: string[]`
      (optional) and `hooks: { [hookName]: string | { script: string } }` (optional, keys
      restricted to the 12 declared in spec FR-020).
- [ ] T102 [P] Extend `.github/scripts/validate-config.mjs`: call `plugin-loader.mjs` after
      structural validation, before returning the final JSON; add the semantic checks from
      spec FR-050/FR-051/FR-052 (needs `fs.existsSync` for Dockerfile/context/compose paths, and
      `yq -o=json eval '.services | keys' <compose>` shelled out once to cross-check service
      names).
- [ ] T103 [P] `tests/fixtures/plugins/fixture-plugin/plugin.mjs` — minimal plugin exporting one
      default, one validate() rule, one hook, used only by tests.
- [ ] T104 `tests/unit/plugin-loader.test.mjs` — resolution order, config-always-wins, unknown
      plugin name, two plugins defaulting the same field.
- [ ] T105 `tests/unit/validate-config.test.mjs` (extend) — new fixtures:
      `config/valid/with-plugins.yml`, `with-hooks.yml`; `config/invalid/unknown-plugin.yml`,
      `unknown-hook.yml`, `missing-dockerfile.yml`, `missing-context.yml`, `missing-compose.yml`,
      `service-not-in-compose.yml`, `duplicate-env-destination.yml`.

**Checkpoint**: `node --test tests/unit` covers plugin resolution and every new semantic check in
isolation, no GitHub Actions run needed.

## Phase 2: User Story 1 — Build matrix (Priority: P1) 🎯

- [ ] T110 [US1] `.github/workflows/ci-cd.yml` — `load` job (checkout + `load-config`, output
      `images` JSON), `build` job (`strategy.matrix.image`, `fail-fast: false`, `uses:
      ./.github/workflows/docker-build.yml`, then `actions/upload-artifact` of
      `image-${{ matrix.image.id }}.json`), `collect` job (`actions/download-artifact` merge +
      `jq` fan-in into `image_refs`), `deploy` job (`uses: ./.github/workflows/deploy-stack.yml`)
- [ ] T111 [US1] `docker-build.yml`: add an output step writing `{id, image, tag, digest, size}`
      as a job summary artifact payload (no contract change to existing inputs/outputs — purely
      additive so standalone callers, e.g. Pricely's current draft, are unaffected)
- [ ] T112 [US1] `tests/fixtures/config/valid/multi-image-matrix.yml` — 4 images
- [ ] T113 [US1] `tests/bats/matrix-fanin.bats` — unit-tests the `jq` merge logic used by the
      `collect` job against 1, 3, and 4 fixture `image-*.json` payloads (pure logic, no real
      Actions run needed)
- [ ] T114 [US1] `docs/adding-a-project.md` / README: new projects are told to use `ci-cd.yml`
      first; `docker-build.yml`/`deploy-stack.yml` direct use documented as the advanced path

**Checkpoint**: adding a 4th entry to `multi-image-matrix.yml` and re-running the fan-in test
produces 4 collected image refs with zero workflow changes.

## Phase 3: User Story 2 — Plugins (Priority: P1)

- [ ] T120 [P] [US2] `.github/plugins/postgres/plugin.mjs` — defaults for
      `database.backup`/health-check template; `validate()` requires `database.engine: postgres`
- [ ] T121 [P] [US2] `.github/plugins/mysql/plugin.mjs`
- [ ] T122 [P] [US2] `.github/plugins/redis/plugin.mjs` — default `dependencyServices` entry
- [ ] T123 [P] [US2] `.github/plugins/prisma/plugin.mjs` — default migration/reset/seed command
      convention (`npx prisma migrate deploy`, etc.), `pre_migration` hook default
      (`npx prisma generate`)
- [ ] T124 [P] [US2] `.github/plugins/nestjs/plugin.mjs` — default health-check template
- [ ] T125 [P] [US2] `.github/plugins/nextjs/plugin.mjs` / `.github/plugins/vite/plugin.mjs` —
      default health-check templates for frontend services
- [ ] T126 [US2] `tests/unit/plugin-loader.test.mjs` (extend) — one test per shipped plugin
      asserting its declared defaults/validate rule
- [ ] T127 [US2] `docs/plugins.md` — what a plugin is, how resolution order works, the shipped
      catalog
- [ ] T128 [US2] `docs/adding-a-plugin.md` — step-by-step authoring guide (the `plugin.mjs`
      shape, how to test it, how to submit it)

**Checkpoint**: `tests/fixtures/config/valid/with-plugins.yml` (declares `plugins: [postgres,
prisma]` and nothing else database-related beyond identifiers) validates successfully with
defaults filled.

## Phase 4: User Story 3 — Hooks (Priority: P2)

- [ ] T130 [US3] Rename `.github/actions/run-database-command` → `.github/actions/run-remote-command`
      (update all callers in `deploy-stack.yml`)
- [ ] T131 [US3] `deploy-stack.yml`: add `if`-gated `run-remote-command` steps for
      `pre_backup`/`post_backup`/`pre_migration`/`post_migration`/`pre_deploy`/`post_deploy`/
      `pre_healthcheck`/`post_healthcheck`/`pre_cleanup`/`post_cleanup`, reading the resolved
      command from the config JSON (empty string = no-op, matching FR-023)
- [ ] T132 [US3] `ci-cd.yml`'s `build` job: `pre_build`/`post_build` steps around the
      `docker-build.yml` call, resolved the same way
- [ ] T133 [US3] `tests/fixtures/config/valid/with-hooks.yml` — one hook per lifecycle point,
      mixing inline command / script path / plugin-sourced
- [ ] T134 [US3] `tests/bats/hooks.bats` — resolution (command vs. script vs. plugin), no-op
      when undeclared, drift-check grep against `deploy-stack.yml`/`ci-cd.yml` for all 12 names
- [ ] T135 [US3] `tests/bats/run-remote-command.bats` (renamed/extended from the old
      `run-database-command` coverage)
- [ ] T136 [US3] `docs/hooks.md`

**Checkpoint**: a fixture with a `post_deploy` inline command and a `pre_migration` plugin-
sourced hook both resolve to the expected final command string, verified by T134 without SSH.

## Phase 5: User Story 4 — Release manifest (Priority: P1)

- [ ] T140 [P] [US4] `.github/schema/release-manifest.schema.json`
- [ ] T141 [US4] `.github/actions/release-manifest/action.yml` — assembles the manifest from
      inputs (image results, compose/env checksums, backup file, timings, health results, git
      context), computes `rollbackCommand`, writes JSON output
- [ ] T142 [US4] `deploy-compose`'s `snapshot` stage: also rename
      `release-manifest.json` → `release-manifest.previous.json` before the new one is written
- [ ] T143 [US4] `deploy-stack.yml`: upload the manifest via `actions/upload-artifact`; write it
      to the server via the existing upload mechanism
- [ ] T144 [US4] `deployment-summary`: change inputs to accept the manifest JSON and render
      Markdown from it instead of the current ad hoc per-field inputs
- [ ] T145 [US4] `tests/unit/release-manifest.test.mjs` or `tests/bats/release-manifest.bats` —
      schema-validate a generated manifest against T140; assert `rollbackCommand` matches the
      expected `docker compose --env-file .env.previous -f docker-compose.previous.yml up -d
      --force-recreate` shape
- [ ] T146 [US4] `docs/release-manifest.md`; update `docs/rollback.md` to reference
      `rollbackCommand`

**Checkpoint**: a full local dry run of `release-manifest`'s assembly logic (Bats, mocked inputs)
produces a manifest that validates against its own schema.

## Phase 6: User Story 5 — Semantic validation (Priority: P2)

*(Implementation is T102/T105 above; this phase is the fixture/message-quality pass.)*

- [ ] T150 [US5] Verify every new invalid fixture (T105's list) produces a message naming the
      specific offending path/service/name, not a generic error — assert on message content in
      `tests/unit/validate-config.test.mjs`, not just exit code
- [ ] T151 [US5] `docs/troubleshooting.md`: add an entry per new validation failure class

## Phase 7: User Story 6 — Observability (Priority: P3)

- [ ] T160 [US6] Add start/stop timing capture around build (in `ci-cd.yml`), upload, backup,
      migration, deploy(recreate), health-check phases, feeding `release-manifest`
- [ ] T161 [US6] `health-check` action: add `attempts_used` output
- [ ] T162 [US6] `deploy-config.schema.json`: add optional `project.environmentLabel` (non-secret
      display string) used by the summary instead of any secret value
- [ ] T163 [US6] `deployment-summary`: render per-phase timing table, image digest/size table,
      health attempts column

## Phase 8: Release versioning automation

- [ ] T170 `release.yml`: add `update_major_tag` boolean input (default `true`); after tagging a
      non-prerelease `vX.Y.Z`, force-move `refs/tags/vX` to the same commit unless
      `prerelease: true` or the input is `false`. Before moving, run `git merge-base
      --is-ancestor <current vX target> <new commit>`; if the new commit is NOT a descendant
      (e.g. a hotfix tagged from an older branch), skip the move and print a clear warning
      naming both commits instead of regressing the floating tag (resolves the edge case
      `spec.md` deferred to this plan — see `analysis-report.md` Finding 1)
- [ ] T171 `tests/bats/release-major-tag.bats` — pure logic test of the "should move" decision
      (prerelease → no; input false → no; else → yes), without a real git push
- [ ] T172 Update `docs/adr/0004-versioning-strategy.md` (done — amendment already recorded),
      `README.md` versioning section, `CHANGELOG.md`

## Phase 9: Polish & Cross-Cutting

- [ ] T180 [P] `docs/architecture.md` — describe `ci-cd.yml`, plugin resolution order, hook
      execution split, manifest-as-source-of-truth
- [ ] T181 [P] `docs/caller-contract.md` — document `ci-cd.yml`'s contract, `plugins:`/`hooks:`
      config fields, `run-remote-command` rename
- [ ] T182 [P] `README.md` — shrink the minimal caller example to the two-file target (spec
      FR-080), using `ci-cd.yml`
- [ ] T183 Grep-based test update (`tests/bats/no-project-literals.bats`) to also cover
      `.github/plugins/`
- [ ] T184 `make validate` / `ci.yml`: add the new fixture directories and renamed action to the
      shellcheck/bats globs (should be automatic given existing glob patterns — verify, don't
      assume)
- [ ] T185 Full `/speckit-analyze`-equivalent pass (project task #23) before implementation is
      considered complete
- [ ] T186 Update `Pricely/migrate/reusable-workflows-v1` draft to call `ci-cd.yml` instead of
      building backend/web as two separate jobs, demonstrating the consumer-experience win
      end-to-end (still `workflow_dispatch`-only, still not cut over)

## Dependencies & Execution Order

Phase 1 (foundational: plugin loader + schema + validator) blocks Phases 3, 4, 6 (plugins, hooks,
and semantic validation all depend on the loader/validator changes). Phase 2 (build matrix) is
independent of Phase 1 and can proceed in parallel. Phase 5 (manifest) depends on Phase 2 (needs
the collected image results) and benefits from Phase 4 existing (hooks can be recorded in the
manifest, though not required). Phase 7 (observability) depends on Phase 5 (manifest is where
timings/digests live). Phase 8 is fully independent. Phase 9 depends on everything else being in
place to document accurately.
