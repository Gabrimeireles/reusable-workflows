# Feature Specification: Reusable CI/CD Platform for Personal Projects

**Feature Branch**: `001-reusable-ci-platform`

**Created**: 2026-08-01

**Status**: Draft

**Input**: User description: "Reformulate reusable-workflows into a real reusable CI/CD platform
for personal GitHub projects, with Pricely as the reference and first consumer. Consumer
workflows must become thin and declarative: they define triggers, minimal permissions, call a
versioned workflow from reusable-workflows, pass project-specific configuration, and forward
secrets — never reimplementing Tailscale, SSH, GHCR, upload, backup, deploy, or health checks."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build one or many container images from a monorepo (Priority: P1)

As the maintainer of a personal project (e.g. Pricely, with separate `backend` and `web`
services in one repository), I want a single reusable build workflow that builds and publishes
one or more container images to GHCR, so that I don't hand-roll Buildx/login/tagging logic in
every project and every service.

**Why this priority**: Nothing else works without images to deploy; this is also the piece
already partially reused today, so it is the safest place to prove the new contract.

**Independent Test**: Point the reusable build workflow at a project with a `backend/Dockerfile`
and a `web/Dockerfile` (each with its own `package.json`, neither at the repo root) and confirm
both images are built, tagged with an immutable SHA-based tag, and pushed to GHCR, with no
requirement for a root-level `package.json`.

**Acceptance Scenarios**:

1. **Given** a project with one image definition (context + Dockerfile), **When** the build
   workflow runs on a push to the default branch, **Then** it publishes an image tagged with the
   commit SHA and, only on that branch, also tags/pushes `latest`.
2. **Given** a project with two image definitions (backend, web) each with its own
   `package.json` inside its own subfolder, **When** the build workflow runs, **Then** both
   images build successfully without any reference to a root `./package.json`.
3. **Given** a pull request from a fork or branch, **When** the build workflow runs, **Then** it
   builds the image(s) to validate the Dockerfile but does not log in to GHCR and does not push
   anything.
4. **Given** a build definition with non-secret build args (e.g. a public API base URL), **When**
   the build runs, **Then** those args are passed to `docker build`, and no mechanism exists for
   passing a secret value as a plain build arg.

---

### User Story 2 - Deploy a full stack to a homolog server with one thin caller workflow (Priority: P1)

As the maintainer of Pricely, I want my repository's deploy workflow to only declare triggers,
permissions, and project configuration, and delegate every other step (Tailscale, SSH, GHCR
login on the server, file upload, backup, migration, seed, service restart, health checks,
cleanup, summary) to the reusable platform, so that my workflow file stays small and every
project I own behaves consistently.

**Why this priority**: This is the core pain point driving the whole rewrite — today the
central repository only builds images, and every operational behavior is duplicated inside
Pricely's own workflow.

**Independent Test**: Replace Pricely's ~275-line deploy workflow with a caller workflow of a
few dozen lines that only sets inputs/secrets and calls the reusable deploy workflow, and
confirm the resulting deploy reaches the same running state (same containers, same env files on
the server, same backup/retention/health-check behavior) as the current workflow.

**Acceptance Scenarios**:

1. **Given** a caller workflow with `deploy_path: /srv/stacks/pricely` and two required images
   already built, **When** the deploy workflow runs, **Then** it connects over Tailscale (when
   enabled), sets up SSH with host-key verification, creates the deploy directory if missing,
   uploads the Compose file and per-app env files with owner-only permissions, removes the local
   temporary copies, logs in to GHCR on the remote host, and pulls the images.
2. **Given** a project with a Postgres service enabled, **When** the deploy workflow runs,
   **Then** it starts dependency services, waits for Postgres to accept connections, takes a
   `pg_dump` backup, verifies the backup with `pg_restore --list`, applies the caller-provided
   retention policy, and only then runs the caller-provided migration (or, if explicitly
   requested via `workflow_dispatch`, reset) command and optional seed command, before
   recreating the application services.
3. **Given** a health-check configuration with an internal Compose-service check and a public
   HTTP check, **When** the deploy workflow runs, **Then** it waits for both according to their
   configured retries/interval and fails the run (printing recent container logs) if either
   never succeeds.
4. **Given** a deploy that completes (success or failure), **When** the run finishes, **Then** a
   step summary is produced listing the project, environment, image tags, whether
   migration/reset/seed ran, and health-check outcome.
5. **Given** two pushes to the same branch in quick succession, **When** the second deploy
   starts while the first is still running, **Then** the second run waits for the first to
   finish rather than deploying concurrently to the same stack.

---

### User Story 3 - Add a new personal project to the platform without copy-pasting deploy logic (Priority: P2)

As the maintainer of a future personal project (not Pricely), I want to adopt the same reusable
build and deploy workflows by writing only a short caller workflow and a project configuration
(inputs and/or a declarative file), so that adopting the platform is fast and I don't reinvent
infrastructure automation per project.

**Why this priority**: Proves the platform actually generalizes beyond Pricely, which is the
stated architectural goal — a platform used by exactly one consumer that still hardcodes that
consumer's assumptions has not achieved its purpose.

**Independent Test**: Write a caller workflow and config for a project with a single image, no
database, and health checks disabled, using only the documented inputs, and confirm it deploys
successfully without needing to add anything project-specific to the reusable-workflows
repository.

**Acceptance Scenarios**:

1. **Given** a project with no database, **When** the deploy workflow runs, **Then** all
   database-related steps (backup, migration, reset, seed) are skipped without error.
2. **Given** a project that disables Tailscale, **When** the deploy workflow runs, **Then** it
   connects over SSH directly without attempting a Tailscale connection.
3. **Given** the documentation in this repository, **When** a maintainer follows
   `docs/adding-a-project.md` step by step for a brand-new project, **Then** they reach a
   working deploy without reading the reusable workflow's internal source code.

---

### User Story 4 - Protect destructive database operations (Priority: P1)

As the maintainer of any project on this platform, I want database resets to be impossible to
trigger accidentally from a normal push, so that a routine deploy can never wipe production or
homolog data.

**Why this priority**: Data loss is the highest-severity failure mode this platform can cause;
it must be structurally prevented, not just discouraged by convention.

**Independent Test**: Attempt to set the reset input to `true` on a `push`-triggered run and
confirm the workflow refuses to proceed with the reset (failing the run with a clear message)
even if the value somehow arrives as `true`.

**Acceptance Scenarios**:

1. **Given** a `push` event, **When** the deploy workflow evaluates the reset input, **Then** it
   treats the reset as forbidden regardless of the input's value and fails clearly if it is
   `true`.
2. **Given** a `workflow_dispatch` event with `reset_database: true`, **When** the deploy runs,
   **Then** it prints an explicit destructive-operation warning, still takes and verifies a
   pre-deploy backup first, and only then runs the caller-provided reset command.

---

### Edge Cases

- What happens when a required secret (e.g. `DEPLOY_SSH_KEY`) is missing from the caller
  repository? The deploy run MUST fail fast, before any SSH or upload attempt, with a message
  naming the missing secret — never a generic downstream error.
- What happens when the Compose file path, an image context, or a configured deploy path
  attempts to escape its expected root (e.g. `../../etc`)? The run MUST fail validation before
  any file is uploaded or any remote command runs.
- What happens when the public health check succeeds but the internal Compose health check
  never does (or vice versa)? Both are evaluated and reported independently; either one failing
  fails the run.
- What happens when a project declares an environment file as `required: true` but the
  corresponding secret is empty? The run MUST fail before upload rather than writing an empty
  file to the server.
- What happens when the pre-deploy backup step itself fails (e.g. `pg_dump` errors, or
  `pg_restore --list` cannot read the dump)? The run MUST stop before touching migrations or
  recreating services — an unverified or missing backup blocks the deploy.
- What happens when the previous deploy's image tag is needed for a manual rollback? The
  platform MUST record, in the run summary, enough information (previous vs. new image
  references, backup file path) for a human to perform a manual rollback; it does not attempt an
  automatic rollback in this version (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Build**

- **FR-001**: The platform MUST support building one or more independently-configured
  container images from a single repository (monorepo), each with its own build context and
  Dockerfile path.
- **FR-002**: The platform MUST NOT require a `package.json` at the repository root; any
  version-extraction behavior MUST accept a configurable path and MUST be optional.
- **FR-003**: The platform MUST publish images to GHCR with an immutable SHA-derived tag, and
  MUST only additionally tag/push a floating tag (e.g. `latest`) on a caller-configured branch.
- **FR-004**: The platform MUST produce the full image reference and digest as outputs usable by
  a subsequent deploy step.
- **FR-005**: The platform MUST NOT log in to the registry or push images when triggered by a
  pull request.
- **FR-006**: The platform MUST support passing non-secret build arguments and MUST NOT offer an
  input path that treats a secret as a plain build argument.
- **FR-007**: The platform MUST declare only the minimum permissions a build job needs
  (`contents: read`, `packages: write`).

**Deploy**

- **FR-010**: The platform MUST wait for all image builds a given deploy depends on before
  starting deployment steps.
- **FR-011**: The platform MUST connect over Tailscale before SSH only when the caller enables
  it, and MUST support disabling it entirely.
- **FR-012**: The platform MUST set up SSH with host-key verification (via `ssh-keyscan` written
  to a scoped `known_hosts`) and MUST retry a bounded number of times before failing clearly.
- **FR-013**: The platform MUST validate, before touching the network, that the caller's
  supplied deploy path is an absolute path under the configured base directory (default
  `/srv/stacks`) and rejects any path containing traversal segments.
- **FR-014**: The platform MUST create the remote deploy directory if it does not exist.
- **FR-015**: The platform MUST write any temporary local file containing secret material with
  `umask 177`, upload it, and remove the local copy in the same job step sequence.
- **FR-016**: The platform MUST authenticate to GHCR on the remote host using a caller-provided
  token/PAT mechanism, without ever printing the credential.
- **FR-017**: The platform MUST pull the images referenced by the resolved tags before
  recreating services.
- **FR-018**: The platform MUST support starting dependency services (e.g. database, cache)
  ahead of the application services when the project declares them.
- **FR-019**: When the project enables a database, the platform MUST wait for it to become
  ready, then take a backup, then verify the backup is readable, before running any
  migration/reset command.
- **FR-020**: The platform MUST apply a caller-configured retention policy to backups (deleting
  backups older than N days) and MUST NOT delete the backup just taken for the current run.
- **FR-021**: The platform MUST run a caller-provided migration command by default and MUST
  offer a caller-provided reset command that is only reachable under the constraints in FR-030/
  FR-031.
- **FR-022**: The platform MUST run a caller-provided seed command only when explicitly
  requested for that run.
- **FR-023**: The platform MUST recreate the application services after migration/seed
  completes.
- **FR-024**: The platform MUST support zero, one, or more health checks per deploy, each either
  an HTTP check against a URL or a command run inside a named Compose service, each with
  configurable retries and interval, and MUST allow health checking to be disabled entirely.
- **FR-025**: On any health-check failure, the platform MUST print the affected service's recent
  logs before failing the run.
- **FR-026**: The platform MUST prune dangling local images on the remote host after a
  successful deploy.
- **FR-027**: The platform MUST produce a `$GITHUB_STEP_SUMMARY` for every deploy run containing
  project, environment, image references, whether migration/reset/seed ran, and health-check
  outcome.
- **FR-028**: The platform MUST enforce a concurrency group keyed by project + environment (and,
  where relevant, branch/target) so that two deploys to the same stack never run simultaneously.

**Database safety**

- **FR-030**: A reset/destructive database operation MUST default to disabled and MUST be
  rejected by the workflow when the triggering event is not `workflow_dispatch`, independent of
  what value the caller passes for that input.
- **FR-031**: When a reset is requested on a `workflow_dispatch` run, the platform MUST still
  take and verify a pre-deploy backup first, and MUST print an explicit destructive-operation
  warning in the run output/summary.
- **FR-032**: All database commands (migration, reset, seed) MUST be supplied by the caller;
  the platform MUST NOT hardcode any project's specific command (e.g. no built-in assumption of
  Prisma, npm, or any other toolchain).

**Configuration & secrets**

- **FR-040**: Project-specific values (project name, image definitions, Compose file, service
  names, ports, domains, database identity, migration/reset/seed commands, env file names and
  required-ness, health-check definitions) MUST be suppliable entirely from the caller
  repository, without modifying this repository.
- **FR-041**: The platform MUST validate project name, service names, and any path-like input
  against an explicit allow-list pattern before using them in a shell command or file path.
- **FR-042**: This repository's own secrets (if any exist) MUST NOT be assumed reachable by a
  caller; every secret a reusable workflow needs MUST be declared in that workflow's
  `on.workflow_call.secrets` and supplied by the caller from the caller's own repository (or,
  once on an organization, environment) secrets.
- **FR-043**: No step anywhere in the platform may print a secret value, and no step may write a
  secret value to `$GITHUB_OUTPUT` or a public artifact.

**Testing & validation**

- **FR-050**: The repository MUST include automated checks (lint + unit/fixture tests) that run
  without SSH access, Tailscale, or any real remote server, and that a contributor (or CI) can
  run entirely locally/in-CI before merging.
- **FR-051**: The repository MUST include negative tests proving: path traversal in deploy path
  is rejected, invalid project/service names are rejected, a `push`-triggered reset attempt is
  rejected, and a deploy missing a required secret fails before any network call.

### Key Entities

- **Project**: A consumer repository adopting the platform. Has a name, a deploy base path
  derived from that name, one or more image definitions, a Compose file, optional database
  configuration, zero or more health checks, and a set of environment files.
- **Image definition**: An identifier, a build context, a Dockerfile path, and the resulting
  GHCR image name.
- **Environment (deploy target)**: A label (e.g. `homolog`, `production`) associated with a
  deploy path, a set of secrets/variables, and optionally a GitHub Environment used for
  approval gating of destructive operations.
- **Database configuration**: Whether a database is enabled, its engine and Compose service
  name, and the migration/reset/seed commands to run against it.
- **Health check**: A name, a type (HTTP or in-Compose-service command), and retry/interval
  settings.
- **Deploy run record**: The information captured in a run's summary — image references used,
  whether destructive operations ran, health outcome, backup file reference — sufficient for a
  human to reason about or manually roll back that deploy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A caller workflow for a project with the shape of Pricely (two images, Postgres +
  Redis + pgAdmin, two health checks) can be expressed in well under 100 lines, containing no
  inline Tailscale/SSH/GHCR/backup/migration/health-check shell logic.
- **SC-002**: A maintainer adding a brand-new project with one image and no database can reach a
  first successful deploy by writing only a caller workflow and a config file/inputs, without
  reading or modifying anything under this repository's `.github/`.
- **SC-003**: 100% of the destructive-reset attempts made outside `workflow_dispatch` are
  rejected in automated tests; 0 automated or manual push-triggered runs can reach the reset
  command.
- **SC-004**: 100% of secrets required by any reusable workflow are declared explicitly in that
  workflow's contract; 0 reusable workflow silently depends on a secret existing in this
  repository.
- **SC-005**: Every deploy run (success or failure) produces a step summary a maintainer can
  read to understand what happened without opening raw step logs.
- **SC-006**: The full automated test suite (lint + fixtures + negative tests) completes without
  any SSH connection, Tailscale connection, or reachable production/homolog host.
- **SC-007**: Migrating Pricely to the platform preserves every currently-working behavior
  enumerated in `docs/migration-pricely.md`'s before/after table, verified by a documented
  equivalence check before the old workflow is removed.

## Assumptions

- The reusable workflows repository (`Gabrimeireles/reusable-workflows`) and all current/near-
  term consumer repositories remain public repositories owned by the same personal GitHub
  account (`Gabrimeireles`), not a GitHub Organization, for the initial version of this
  platform; the organization scenario is documented but not required to ship v1.
- `docker compose` (v2, the `docker compose` subcommand) is available on the target deploy host;
  the platform does not support the standalone `docker-compose` v1 binary.
- The deploy target is reachable via SSH (directly or via Tailscale) from a GitHub-hosted
  Ubuntu runner; self-hosted runners are out of scope for v1.
- Automatic rollback (the platform itself detecting a failed deploy and redeploying the prior
  version without human action) is out of scope for v1; this version delivers the information
  and preserved artifacts (previous tag, unremoved backup) needed for a documented **manual**
  rollback procedure. [NEEDS CLARIFICATION: confirmed as an explicit scope decision — see
  Clarifications]
- Project configuration is expressed through a combination of `workflow_call` inputs and an
  optional declarative YAML file in the caller repository, rather than one pure approach.
  [NEEDS CLARIFICATION: confirmed — see Clarifications]
- Callers use `secrets: inherit` when calling the platform's deploy workflow, and the platform
  declares every secret it can possibly use in `on.workflow_call.secrets` so the contract stays
  self-documenting even though `inherit` is used at the call site. [NEEDS CLARIFICATION:
  confirmed — see Clarifications]
