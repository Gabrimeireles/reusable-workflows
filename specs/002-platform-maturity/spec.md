# Feature Specification: Platform Maturity — Matrix, Plugins, Hooks, Manifests

**Feature Branch**: `002-platform-maturity` (implemented on the existing `speckit/reusable-ci-platform` branch, since the platform has not yet reached `v1.0.0` — see Assumptions)

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "Segunda iteração da plataforma de CI/CD reutilizável, focada em
extensibilidade, desacoplamento, redução de configuração e maior genericidade: build orientado
por matrix, arquitetura de plugins, hooks completos de ciclo de vida, manifesto de release,
preparação para rollback, validação semântica, observabilidade rica, versionamento automático,
e redução adicional do tamanho do projeto consumidor." Full context and design rationale:
`specs/002-platform-maturity/architecture-analysis.md` and `clarify-log.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a new image without touching any workflow (Priority: P1)

As a maintainer of a project on this platform, I want to add a third or fourth container image
to my project by only editing my declarative config file, so that growing my project's service
count never requires copy-pasting a build job.

**Why this priority**: This is the single most-cited limitation of iteration 1 and the platform's
core reusability promise ("edit the file, not the workflow").

**Independent Test**: Add a third image entry to a test project's `images` list and confirm all
three images build and publish without any change to the caller's workflow file.

**Acceptance Scenarios**:

1. **Given** a config with 2 images, **When** a maintainer adds a 3rd image entry, **Then** the
   next run builds and publishes 3 images without any workflow file change.
2. **Given** a config with N images (N ≥ 1), **When** the pipeline runs, **Then** every image's
   name, tag, digest, and size are available to the deploy step as a single collected input,
   regardless of N.
3. **Given** one image's build fails, **When** the pipeline runs, **Then** the other images still
   attempt to build (matrix jobs are independent) and the deploy step does not run.

---

### User Story 2 - Adopt a stack-specific default without re-specifying it (Priority: P1)

As a maintainer adding a new project that uses a common stack (e.g. Postgres + Prisma), I want to
declare `plugins: [postgres, prisma]` and get sane, tested defaults (backup shape, a migration
command convention, a health-check template) instead of writing every field by hand, while still
being able to override any default my project needs to differ on.

**Why this priority**: This is what makes "dozens of different projects" tractable — without it,
every project re-specifies the same boilerplate the platform could know once.

**Independent Test**: A config declaring only `plugins: [postgres]` and the fields a plugin
cannot reasonably default (host-specific identifiers) still produces a fully valid, deployable
resolved configuration.

**Acceptance Scenarios**:

1. **Given** a config declares `plugins: [X]`, **When** the config loads, **Then** any field `X`
   provides a default for, that the config itself doesn't set, is filled from the plugin.
2. **Given** a config explicitly sets a field a declared plugin would also default, **When** the
   config loads, **Then** the config's own value wins — a plugin only fills gaps, never
   overrides.
3. **Given** a config declares a plugin name that doesn't exist under `.github/plugins/`,
   **When** the config loads, **Then** validation fails with a clear, specific error naming the
   unknown plugin.
4. **Given** a new plugin is added under `.github/plugins/<name>/`, **When** no workflow or
   composite action file is modified, **Then** any project may adopt it by name.

---

### User Story 3 - Run project-specific logic at any lifecycle point (Priority: P2)

As a maintainer, I want to run a command before or after build, backup, migration, deploy,
health-check, or cleanup, so that project-specific needs (e.g. clearing a CDN cache after
deploy, warming a cache before health-checking) don't require a platform change.

**Why this priority**: Generalizes the existing migration/reset/seed mechanism (already proven
in iteration 1) to the full lifecycle, closing a gap the brief explicitly calls out.

**Independent Test**: A config declaring a `post_deploy` hook as an inline command executes it
after service recreation and before health checks; omitting a hook skips it without error.

**Acceptance Scenarios**:

1. **Given** a hook is declared as an inline command, **When** its lifecycle point is reached,
   **Then** the command runs (on the runner for `pre_build`/`post_build`, remotely for all
   others) and its failure fails the run.
2. **Given** a hook is declared as a script path, **When** its lifecycle point is reached,
   **Then** the script executes in place of an inline command.
3. **Given** a hook is provided by a declared plugin and not overridden by the config, **When**
   its lifecycle point is reached, **Then** the plugin's hook runs.
4. **Given** no hook is declared for a given lifecycle point, **When** that point is reached,
   **Then** nothing runs and the deploy proceeds normally.

---

### User Story 4 - Diagnose and manually roll back a deploy from one generated file (Priority: P1)

As a maintainer investigating a bad deploy, I want a single generated manifest recording exactly
what was deployed, so that I don't have to reconstruct the previous state from memory, logs, or
prose documentation.

**Why this priority**: Directly enables safer operations without taking on the risk of automatic
rollback (explicitly out of scope, per iteration 1's ADR 0006, unchanged here).

**Independent Test**: After any deploy run (success or failure), a `release-manifest.json` exists
on the server and as a workflow artifact, containing a literal rollback command that, when run
verbatim, restores the previous release's containers.

**Acceptance Scenarios**:

1. **Given** a deploy completes (success or failure), **When** the run finishes, **Then** a
   release manifest is written to the server and attached as a workflow artifact.
2. **Given** a second deploy runs, **When** it starts, **Then** the previous manifest is
   preserved (renamed, not deleted) before the new one is written.
3. **Given** a maintainer reads the manifest, **When** they run its `rollbackCommand` verbatim on
   the server, **Then** the previously-running images and Compose configuration are restored.
4. **Given** the step summary is generated, **When** a maintainer reads it, **Then** every value
   shown also appears in the manifest — the two are never inconsistent, because the summary is
   rendered from the manifest.

---

### User Story 5 - Get actionable errors before a deploy ever starts (Priority: P2)

As a maintainer editing a project's config, I want invalid configuration (a missing Dockerfile, a
service name that doesn't exist in the Compose file, an unknown plugin) caught with a specific,
actionable message, so that I fix my config instead of debugging a cryptic mid-deploy failure.

**Why this priority**: Extends already-proven schema validation (iteration 1) to semantic
checks that need the checked-out repository, catching a materially larger class of mistakes
before any SSH connection is attempted.

**Independent Test**: A config referencing a Dockerfile that doesn't exist, or a Compose service
name not declared in the Compose file, fails validation with a message naming the specific
missing file or service — not a generic error.

**Acceptance Scenarios**:

1. **Given** `images[].dockerfile` or `images[].context` doesn't exist in the checked-out repo,
   **When** the config loads, **Then** validation fails naming the specific missing path.
2. **Given** `compose.source` doesn't exist, **When** the config loads, **Then** validation fails
   naming it.
3. **Given** any service name referenced anywhere in the config isn't declared under `services:`
   in the resolved Compose file, **When** the config loads, **Then** validation fails naming the
   specific service and where it was referenced.
4. **Given** two `environmentFiles` entries share the same `destination`, **When** the config
   loads, **Then** validation fails naming the duplicate destination.
5. **Given** all issues above occur simultaneously in one config, **When** the config loads,
   **Then** every issue is reported in one pass, not just the first.

---

### User Story 6 - Understand exactly where deploy time goes (Priority: P3)

As a maintainer, I want the deploy summary to show per-phase timing, image size/digest, and
health-check attempt counts, so that I can tell whether a slow deploy is a build problem, an
upload problem, or a health-check problem, without reading raw logs.

**Why this priority**: Quality-of-life improvement; does not block adoption the way User Stories
1-5 do.

**Independent Test**: A completed deploy's summary shows separate timings for build, upload,
backup, migration, deploy, and health-check phases, plus each image's digest and size.

**Acceptance Scenarios**:

1. **Given** a deploy completes, **When** the summary renders, **Then** it shows a duration for
   each of: build, upload, backup, migration, deploy, health-check.
2. **Given** a deploy completes, **When** the summary renders, **Then** each image's digest and
   size are shown (previously computed but not surfaced).
3. **Given** a health check retries before succeeding, **When** the summary renders, **Then** the
   number of attempts used is shown.
4. **Given** the summary is rendered, **When** it includes any infrastructure label, **Then** no
   secret value (e.g. the literal deploy host) is ever printed — only a caller-supplied,
   non-secret display label, if configured.

---

### Edge Cases

- What happens when a plugin's `defaults` and another declared plugin's `defaults` conflict
  (both try to default the same field differently)? Later-declared plugins in the `plugins:`
  list MUST NOT silently override earlier ones without it being visible — resolution order MUST
  be documented and deterministic (declaration order, first-applied-wins, matching how the
  caller's own config already always wins over any plugin).
- What happens when a hook's script path doesn't exist in the caller's repo? Validation MUST
  catch this before any deploy step runs, the same as a missing Dockerfile.
- What happens when the matrix build has zero images (should be prevented by existing schema
  `minItems: 1`, but the orchestrator must not silently no-op if it somehow receives an empty
  set)? The pipeline MUST fail clearly rather than proceeding to a deploy with no images.
- What happens when an artifact from one matrix build instance fails to upload? The collect step
  MUST fail the run rather than silently deploying with a missing image.
- What happens when `update_major_tag` would move `v1` backward (e.g. a hotfix release tagged
  from an older branch)? The auto-move MUST compare commit ancestry or at least warn rather than
  blindly force-moving to an older commit — exact behavior is an implementation detail for
  `/speckit-plan`, not re-litigated here.

## Requirements *(mandatory)*

### Functional Requirements

**Build matrix**

- **FR-001**: The platform MUST provide an entry-point reusable workflow that builds every image
  listed in the caller's declarative config without the caller declaring one job per image.
- **FR-002**: Adding or removing an image MUST require editing only the declarative config file.
- **FR-003**: The platform MUST collect every matrix build instance's image reference, tag,
  digest, and size into a single structure consumable by the deploy step, without relying on
  GitHub Actions' non-deterministic single-instance matrix-job output behavior.
- **FR-004**: `docker-build.yml` and `deploy-stack.yml` MUST remain independently callable (not
  every project is required to adopt the new entry-point workflow in one step).

**Plugin architecture**

- **FR-010**: A plugin MUST be addable by adding files under a dedicated directory in this
  repository, without modifying any reusable workflow or composite action.
  (Constitution Principle XVI.)
- **FR-011**: A plugin MAY contribute: default configuration values, additional semantic
  validation, default hook commands, and default health-check definitions.
- **FR-012**: A caller's own configuration value MUST always take precedence over a plugin
  default for the same field.
- **FR-013**: Declaring an unknown plugin name MUST fail validation with a specific, actionable
  message.
- **FR-014**: The platform MUST ship an initial, documented set of plugins covering at least one
  backend framework, one ORM/migration tool, one frontend framework, and Postgres, sufficient to
  demonstrate the mechanism end-to-end (exact initial set decided at `/speckit-plan`).

**Hooks**

- **FR-020**: The platform MUST support named hooks at each of: `pre_build`, `post_build`,
  `pre_backup`, `post_backup`, `pre_migration`, `post_migration`, `pre_deploy`, `post_deploy`,
  `pre_healthcheck`, `post_healthcheck`, `pre_cleanup`, `post_cleanup`.
- **FR-021**: A hook MUST be resolvable as an inline command, a script path in the caller's
  repository, or a plugin-provided default, with the config loader resolving all three to one
  final command before any executor runs it.
- **FR-022**: `pre_build`/`post_build` hooks MUST run on the GitHub-hosted runner; all other
  hooks MUST run on the remote deploy host, using the platform's existing safe remote-execution
  mechanism (opaque command via SSH, no direct string interpolation).
- **FR-023**: An undeclared hook MUST be a no-op, never an error.

**Release manifest**

- **FR-030**: Every deploy run MUST produce a release manifest containing: git commit, branch,
  triggering actor, every image's name/tag/digest/size, the Compose file used, a checksum of the
  Compose file and of the rendered `.env`, whether a backup was created and its path, start
  timestamp, total duration, the platform/config version, every health check's outcome, and a
  literal rollback command. (Constitution Principle XVII.)
- **FR-031**: The manifest MUST be written to the server, with the previous run's manifest
  preserved (renamed), and MUST also be attached as a workflow artifact.
- **FR-032**: The human-readable step summary MUST be generated from the manifest's data, not
  computed independently.

**Rollback preparation**

- **FR-040**: The platform MUST continue to preserve the previous Compose file, `.env`, and a
  verified pre-deploy backup, per iteration 1, and MUST additionally preserve the previous
  release manifest.
- **FR-041**: No automatic rollback is introduced by this iteration (ADR 0006 unchanged).

**Semantic validation**

- **FR-050**: Config validation MUST verify, using the already-checked-out caller repository:
  every image's Dockerfile and context path exist; the Compose source file exists; every service
  name referenced anywhere in the config exists in the resolved Compose file's `services:` key.
- **FR-051**: Config validation MUST reject duplicate `environmentFiles[].destination` values.
- **FR-052**: Config validation MUST reject a declared plugin name with no matching plugin
  directory, and a hook name outside the fixed set in FR-020.
- **FR-053**: All semantic issues found MUST be reported together in one validation pass, per
  the existing (iteration 1) validator behavior.
- **FR-054**: Port-duplication validation is explicitly out of scope for this iteration (see
  clarify-log Q1) — the config does not model ports.

**Observability**

- **FR-060**: The manifest/summary MUST include a separate duration for each of: build, upload,
  backup, migration, deploy (service recreation), health-check.
- **FR-061**: The manifest/summary MUST include each image's digest and size.
- **FR-062**: The manifest/summary MUST include, per health check, the number of attempts used.
- **FR-063**: The manifest/summary MUST NOT print any secret value; any infrastructure label
  shown MUST come from a caller-supplied, non-secret display field.

**Release versioning automation**

- **FR-070**: `release.yml` MUST, after tagging a non-prerelease `vMAJOR.MINOR.PATCH`, move the
  floating `vMAJOR` tag to that commit automatically.
- **FR-071**: `release.yml` MUST accept a boolean input (default `true`) allowing a given run to
  skip the floating-tag move.
- **FR-072**: A prerelease MUST NOT move any floating major tag.

**Consumer experience**

- **FR-080**: A new project's entire CI/CD footprint MUST be reducible to exactly two files: one
  thin caller workflow and one declarative config file, with the build-matrix and plugin
  mechanisms eliminating every previously-identified reason a caller needed more.

**Backward compatibility**

- **FR-090**: `docker-deploy-ssh.yml`, `github-release.yml`, `swagger-pages.yml`, and
  `docker-build.yml`'s pre-existing inputs (`image_name`, `dockerfile`, `context`,
  `node_version`, and `version_file`'s current default) MUST NOT change behavior for existing
  pinned callers (`CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, `Conecta_SLA`).
- **FR-091**: Because `deploy-stack.yml`/`release.yml`/`validate-caller.yml`/the declarative
  config schema have no tagged release and no production caller yet (see Assumptions), this
  iteration MAY change their contracts without a major-version bump or deprecation cycle,
  provided `v1.0.0` is not tagged until this iteration is complete.

### Key Entities

- **Plugin**: A named, versionless (for now) bundle of defaults/validation/hooks/health-check
  templates, identified by a directory name under the platform's plugin directory.
- **Hook**: A named lifecycle point resolved, at config-load time, to exactly one final command
  (or none).
- **Release manifest**: The structured record of one deploy run — see FR-030 for its fields.
- **Matrix build result**: One image's collected outcome (id, image, tag, digest, size) after
  fan-in from the build matrix.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A project with 4 images requires the same two files (caller workflow + config) as
  a project with 1 image — zero workflow-file difference.
- **SC-002**: A new plugin can be added and adopted by a project without any diff to
  `.github/workflows/` or `.github/actions/` in this repository.
- **SC-003**: 100% of the twelve declared hook points are reachable and independently testable
  without a real remote server (Principle X).
- **SC-004**: Every deploy run (success or failure) produces a release manifest; 0 runs produce a
  step summary whose values don't trace back to that manifest.
- **SC-005**: The expanded semantic validator catches, in fixtures, 100% of: missing Dockerfile,
  missing context, missing Compose file, undeclared service reference, duplicate env-file
  destination, unknown plugin, unknown hook name — each with a message naming the specific
  offending value.
- **SC-006**: `make validate` (actionlint, shellcheck including composite actions, yamllint,
  node tests, bats) passes with zero new warnings after this iteration.
- **SC-007**: No behavior change is observed for `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`,
  or `Conecta_SLA` (verified by re-diffing the three legacy workflows and `docker-build.yml`'s
  pre-existing input defaults against their pre-iteration-2 state).

## Assumptions

- `deploy-stack.yml`, `release.yml`, `validate-caller.yml`, and the declarative config schema
  remain pre-1.0 (no `v1` tag cut) until this iteration lands, per FR-091 — confirmed as an
  explicit scope decision, not a silent assumption (see `architecture-analysis.md` §0).
- The initial plugin set (FR-014) is illustrative/foundational, not exhaustive — the mechanism,
  not full framework coverage, is this iteration's deliverable.
- Ports remain outside the declarative config's model (clarify-log Q1); "duplicate ports"
  validation is not delivered by this iteration.
- Health checks remain capped at 4 inline slots (clarify-log Q2); no matrix-based health-check
  fan-in is introduced.
