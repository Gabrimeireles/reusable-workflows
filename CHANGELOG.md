# Changelog

All notable changes to this repository are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). See
[`docs/adr/0004-versioning-strategy.md`](docs/adr/0004-versioning-strategy.md) for the
versioning and tagging policy.

## [Unreleased] — reusable CI/CD platform rewrite

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
