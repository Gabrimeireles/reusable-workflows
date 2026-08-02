# Changelog

All notable changes to this repository are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). See
[`docs/adr/0004-versioning-strategy.md`](docs/adr/0004-versioning-strategy.md) for the
versioning and tagging policy.

## [Unreleased] — platform maturity (iteration 2)

Still pre-`v1.0.0` — see `specs/002-platform-maturity/` for the full critical analysis (done
before any code changed, per explicit instruction) and spec/plan/tasks/analysis trail.

### Added
- `ci-cd.yml`: the new recommended entry point — a build matrix over the config's `images` list
  (adding an image is now a config-only change) with artifact-based fan-in, feeding
  `deploy-stack.yml`. `docker-build.yml`/`deploy-stack.yml` remain independently callable.
- Plugin system (`.github/plugins/`, `docs/plugins.md`): `postgres`, `redis`, `prisma`, `nestjs`,
  `nextjs`, `vite`. Resolved by the Node config loader via dynamic `import()` — no reusable
  workflow or composite action changes when a new plugin is added.
- 12 lifecycle hooks (`pre_build` .. `post_cleanup`, `docs/hooks.md`), each resolvable as an
  inline command, a script path, or a plugin default.
- Release manifest (`release-manifest.json`, `docs/release-manifest.md`): git provenance,
  per-image ref/digest/size, Compose/env checksums, backup reference, per-phase timings, health
  results, and a literal `rollbackCommand`. The deploy summary now renders from it instead of
  computing its own values.
- `release.yml` automatically moves the floating `vMAJOR` tag after each non-prerelease release,
  with an ancestry check to avoid regressing it from an out-of-order hotfix, and a
  `update_major_tag` opt-out input.
- Expanded semantic validation: Dockerfile/context/Compose-file existence, cross-referencing
  every service name against the Compose file's own `services:` map, duplicate env-file
  destinations, unknown plugin/hook names.
- Constitution v1.1.0: Principle XVI (extensibility lives in data/scripts, never dynamic
  `uses:`) and Principle XVII (every deploy produces a release manifest).

### Changed (non-breaking — see Assumptions in `specs/002-platform-maturity/spec.md`)
- `run-database-command` renamed `run-remote-command` (now the executor for all remote hooks,
  not just migration/reset/seed); its `service` input is now optional (host-level execution when
  empty). Zero released consumers of the old name existed.
- `deploy-compose` gains a `cleanup` stage (previously image pruning was embedded in `recreate`).
- `deployment-summary`'s input contract changed to take the manifest JSON instead of individual
  fields — internal-only, no external caller.
- `docker-build.yml` gains `artifact_id`, `pre_build_command`, `post_build_command` inputs (all
  optional, default off) for matrix/hook support — standalone callers unaffected.

## [Unreleased] — reusable CI/CD platform rewrite (iteration 1)

### Added
- `deploy-stack.yml`, `release.yml`, `validate-caller.yml`, `ci.yml` reusable workflows.
- Composite actions: `resolve-project`, `load-config`, `setup-network`, `setup-ssh`,
  `prepare-deploy-files`, `upload-deploy-files`, `deploy-compose`, `backup-postgres`,
  `run-database-command`, `health-check`, `deployment-summary`.
- Declarative deploy config format (`.github/deploy/<environment>.yml`) with JSON Schema
  (`.github/schema/deploy-config.schema.json`) and a dependency-free validator
  (`.github/scripts/validate-config.mjs`).
- Full test suite: `node --test` unit tests for the config validator, `bats` specs for the
  shared image-tag logic, the push-triggered reset guard, and secret-exposure/no-project-literal
  regression checks.
- `Makefile`, `scripts/bootstrap.sh`, `.yamllint.yml`, `.github/dependabot.yml`.
- Full documentation set under `docs/`, six ADRs, and the Spec Kit process artifacts under
  `specs/001-reusable-ci-platform/`.

### Changed (non-breaking)
- `docker-build.yml`: added optional `version_file` input (default `./package.json`, preserving
  the exact previous behavior), `build_args`, and `default_branch` inputs. A missing
  `version_file` now skips version-tag extraction instead of failing the build, which is what
  unblocks monorepo images (e.g. `backend/package.json`, `web/package.json`) without breaking
  any existing caller that has a root `package.json`.

### Unchanged (explicitly)
- `docker-deploy-ssh.yml`, `github-release.yml`, `swagger-pages.yml` keep their exact existing
  contract and behavior — `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, and `Conecta_SLA` are
  pinned to them at `v1.5`/`v1.7`/`v1.8` (discovered via `gh search code`, not assumed; see
  `specs/001-reusable-ci-platform/analysis-report.md` Finding 2).

## Prior history (pre-rewrite)

See `git log` for `v1` through `v1.8` — org-wide reusable workflows for build, SSH+Compose
deploy, GitHub Releases, and Swagger-to-Pages publishing.
