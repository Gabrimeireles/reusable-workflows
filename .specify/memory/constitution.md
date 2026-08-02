<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles: none redefined
- Added principles: XVI. Extensibility Lives in Data and Scripts, Not Dynamic Workflow Syntax;
  XVII. Every Deploy Produces a Release Manifest
- Added sections: none beyond the two principles
- Removed sections: none
- Rationale: iteration 2 ("platform maturity" — see specs/002-platform-maturity/) introduces a
  plugin system and a release manifest as load-bearing architectural guarantees, not optional
  features, so they are elevated to constitutional principles the same way Principle XI already
  guarantees a step summary.
- Templates checked for alignment:
  - .specify/templates/plan-template.md - OK, generic, no update needed
  - .specify/templates/spec-template.md - OK, generic, no update needed
  - .specify/templates/tasks-template.md - OK, generic, no update needed
  - .specify/templates/checklist-template.md - OK, generic, no update needed
- Follow-up TODOs: none
-->

# Reusable Workflows (Gabrimeireles) Constitution

## Core Principles

### I. Minimal, Declarative Callers
A consumer repository's workflow file MUST only: declare triggers, declare minimal
`permissions:`, call one or more versioned workflows from this repository via `uses:`, pass
project-specific `with:` inputs (or a path to a declarative config file), and forward secrets.
A caller workflow MUST NOT contain inline shell steps that implement Tailscale, SSH, GHCR
login, file upload, database backup/migration/seed, health checking, or image cleanup — that
logic MUST live exclusively in this repository's reusable workflows and composite actions.
Rationale: this is the entire reason this repository exists; if logic leaks back into callers,
every consumer re-diverges and the platform stops being reusable.

### II. Security by Default
Every workflow and composite action MUST: run shell steps with `set -euo pipefail`; write any
temporary secret-bearing file with `umask 177` before creation and remove it in the same job;
verify the SSH host key via `ssh-keyscan` output pinned to `known_hosts` (never
`StrictHostKeyChecking=no`); pass caller-supplied values into shell via `env:` rather than
direct `${{ }}` interpolation inside `run:` blocks. Rationale: this platform manages production
deploy credentials for personal infrastructure; insecure defaults here compromise every project
that adopts it.

### III. No Secret Exposure (NON-NEGOTIABLE)
No step may print a secret value to logs, echo it for debugging, or write it to
`$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY`, or any artifact. Secret-derived files on the runner or
remote host MUST be created with owner-only permissions and deleted after use. Automated tests
MUST include a check that greps workflow/action source for patterns that would leak a secret
(e.g. `echo ${{ secrets.` outside of an explicit allow-listed masking helper).

### IV. Backward Compatibility Within a Major Version
Within the same major tag (e.g. all `v1.x.y`), published input names, input types, default
behaviors, secret names, and output names MUST NOT change in a way that breaks an existing
caller pinned to that major. Additive, optional changes are allowed. Any breaking change MUST
be released as a new major version with a migration note in `CHANGELOG.md` and
`docs/adding-a-project.md` / `docs/migration-pricely.md` as applicable.

### V. Immutable Image Tags
Every image built by `docker-build.yml` MUST be tagged with a tag derived from the immutable
git SHA (e.g. `sha-<short-sha>`) in addition to any human-friendly tags. `deploy-stack.yml`
MUST always deploy using the SHA-derived tag, never `latest` or a branch name, so that the
exact set of running images is always reconstructable from the git history of the caller
repository.

### VI. Idempotent Deploy
Running `deploy-stack.yml` twice in a row with identical inputs against the same target and
the same image tag MUST converge to the same running state without manual cleanup: `docker
compose up -d` semantics, `mkdir -p`-safe directory creation, and migration commands that are
themselves safe to re-run (the migration command's own idempotency is the caller's
responsibility per Principle IX, but the orchestration around it MUST NOT assume a clean
slate).

### VII. Destructive Operations Are Always Explicit
Any operation that can destroy data (database reset, forced volume removal) MUST default to
disabled, MUST only be triggerable via `workflow_dispatch` input (never implicitly on `push`),
and the reusable workflow MUST hard-fail if such an input is `true` on a non-`workflow_dispatch`
event, regardless of what the caller passes. Where the underlying platform supports it, the job
performing the destructive action SHOULD be gated behind a GitHub Environment so the caller can
attach required reviewers.

### VIII. Central Workflows Are Generic
Files under this repository's `.github/workflows/` and `.github/actions/` MUST NOT contain a
literal project name, service name, database name, or application-specific command (e.g. no
`pricely`, `prisma`, `npm run db:migrate:deploy:safe` hardcoded outside of `tests/fixtures/` and
documentation examples). Anything project-specific MUST arrive as an input or as a field read
from the caller's declarative config file.

### IX. Project-Specific Configuration Stays With the Project
Image build contexts/Dockerfiles, the Compose file, service names, ports, domains, database
name/user, migration/reset/seed commands, and application env files are owned by the consumer
repository and passed in — never assumed or defaulted to a specific project's values in this
repository.

### X. Tests Never Depend on Production Infrastructure
All automated checks that run in this repository's own CI MUST pass without SSH access,
Tailscale, or any real remote server. SSH/SCP/Docker Compose behavior exercised by tests MUST
use local mocks, fixtures, or ephemeral local containers. No test may write to, or require
credentials for, `Gabrimeireles/Pricely`'s real homolog server or any other production host.

### XI. Mandatory Observability
Every deploy run MUST produce a `$GITHUB_STEP_SUMMARY` entry listing: project, environment,
image names and tags, whether migration/reset/seed ran, health-check outcome, and duration. On
any failure, the workflow MUST print the relevant `docker compose logs` tail for the affected
service(s) before exiting non-zero, so a human can diagnose the failure from the Actions UI
alone.

### XII. Documentation Is Part of the Delivery
A change to any reusable workflow, composite action, or input/output/secret contract MUST land
in the same pull request as the corresponding update to `README.md` and the relevant file(s)
under `docs/` (at minimum `docs/caller-contract.md`). A PR that changes behavior without a
documentation update is incomplete, not "documentation follow-up."

### XIII. Pin External Actions
Every `uses:` step referencing an action outside the `actions/*` and `docker/*`
(GitHub/Docker-official) namespaces MUST be pinned to a full commit SHA, with a trailing
comment noting the human-readable version (e.g. `# v4.1.0`). Dependabot MUST be configured to
open update PRs for these pins on a schedule.

### XIV. Least-Privilege Permissions
Every workflow MUST declare a top-level `permissions:` block scoped to only what its jobs need
(e.g. `contents: read`, `packages: write` only on jobs that push images). Relying on the
repository/organization default `GITHUB_TOKEN` permission is not sufficient and MUST NOT be the
only permissions declaration.

### XV. No Project Becomes an Unconditional Global Rule
Behavior needed specifically for `Pricely` today (two images, Postgres + Redis + pgAdmin,
`wget`-based internal health check, a public health URL) MUST be expressed as configuration
that a future consumer can opt out of or replace, never as an unconditional default baked into
a reusable workflow's logic. `Pricely` is the reference implementation and first consumer, not
a hardcoded special case.

### XVI. Extensibility Lives in Data and Scripts, Not Dynamic Workflow Syntax
GitHub Actions' `uses:` key cannot be resolved dynamically (no expressions), so no workflow or
composite action may attempt to select an action/workflow to run based on a runtime config
value. Extensibility (plugins, hooks, per-application-type defaults) MUST be implemented as data
merged and resolved by the Node config loader (`.github/scripts/validate-config.mjs` and its
plugin modules under `.github/plugins/`) before `deploy-stack.yml` or any composite action ever
sees it. A reusable workflow or composite action MUST NOT change when a new plugin is added —
adding one MUST be possible by adding a new file under `.github/plugins/` alone. Rationale: this
is the only mechanism compatible with GitHub Actions' static `uses:` resolution that still lets
the platform grow to support new application types without editing the workflows every project
depends on.

### XVII. Every Deploy Produces a Release Manifest
Every `deploy-stack.yml` run MUST produce a structured release manifest (image references,
digests, Compose/env checksums, backup reference, timings, health results, git provenance)
written to the server (superseding the previous run's manifest, never deleting it) and attached
as a workflow artifact. The manifest MUST include a literal, ready-to-run rollback command. The
human-readable step summary (Principle XI) MUST be rendered from this manifest, not derived
independently, so the two can never drift from each other.

## Configuration Boundary

Shared infrastructure concerns (deploy host/user/SSH key, GHCR auth mechanism, Tailscale OAuth
credentials and tag, `known_hosts` policy, ssh-keyscan retry policy, the `/srv/stacks` base
path, backup policy, retention policy, health-check policy, image-pruning policy, summary
generation, diagnostic logging) are implemented once, generically, in this repository and
configured per call, never re-implemented per project.

Project-specific concerns (project name, image names/Dockerfiles/build contexts, Compose file,
services to build/run, ports, domains, health-check URL/command, database engine/name/user,
migration/reset/seed commands, env file names and required-ness, frontend-specific build args)
live in the consumer repository, passed as `with:` inputs or via the consumer's own declarative
deploy config file.

## Secrets & Environments Policy

Secrets defined in this repository (`reusable-workflows`) are NEVER automatically available to
a caller's reusable-workflow job — GitHub Actions only forwards secrets that the caller's own
job already has, either explicitly listed under `secrets:` in the `uses:` block or via
`secrets: inherit` (which forwards the caller repository's own repo/org/environment secrets,
not this repository's). Every consumer repository is therefore responsible for holding its own
infrastructure and application secrets as repository (or, once on an organization, environment)
secrets. This repository MUST NOT assume it can source a secret from itself. See
`docs/secrets-and-environments.md` for the full rationale and the personal-account vs.
organization strategies.

## Quality Gates

A change to this repository MUST pass, before merge: `actionlint` on every workflow,
`shellcheck` on every embedded and standalone shell script, `yamllint` on every YAML file,
schema validation of any example/fixture declarative config file, and the repository's own test
suite (fixture-based unit tests plus the path-traversal / invalid-name / forbidden-reset /
missing-secret negative tests). `make validate` MUST run all of the above in one command and
MUST be green before a PR is marked ready for review.

## Governance

This constitution supersedes ad hoc practice for this repository. Amendments require: a
documented rationale in the PR description, a version bump per the rules below, and — if a
principle is weakened or removed — an explicit migration note for existing callers (currently
`Pricely`).

Versioning policy (semantic versioning applied to this document):
- **MAJOR**: a principle is removed or redefined in a way that is backward-incompatible with
  prior guidance.
- **MINOR**: a new principle or materially expanded section is added.
- **PATCH**: wording, typo, or non-semantic clarification.

Every pull request touching `.github/workflows/`, `.github/actions/`, or `docs/` MUST include a
short "Constitution check" note confirming which principles were considered and that none are
violated; if one must be knowingly bent for a real constraint, the PR MUST say so explicitly and
why, rather than silently deviating.

**Version**: 1.1.0 | **Ratified**: 2026-08-01 | **Last Amended**: 2026-08-02
