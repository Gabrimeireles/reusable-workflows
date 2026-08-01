# Clarification Log: Reusable CI/CD Platform for Personal Projects

This is the record of the `/speckit-clarify`-equivalent pass over `spec.md`. The user's own
brief explicitly delegated these three decisions to the implementer with stated evaluation
criteria ("escolha a abordagem que gere melhor equilíbrio...", "avalie a viabilidade de rollback
automático... não implemente rollback automático inseguro apenas para cumprir requisito"),
rather than asking for a specific answer. Per the constitution's "no silent assumptions" rule,
each decision is recorded here as an explicit Q/A with the criteria applied, not just assumed.
The full architectural writeup for each lives in the matching ADR under `docs/adr/`.

## Q1: Configuration model — inputs only, declarative file only, or hybrid?

**Context**: `spec.md` Assumptions; drives FR-040/FR-041 and the whole caller contract.

**Options considered**:
- **A — Explicit `workflow_call` inputs only**: every project-specific value is a top-level
  input.
- **B — Declarative YAML file only**: the caller passes a single `configuration_file` input and
  everything else lives in that file.
- **C — Hybrid**: a handful of top-level inputs for the values every caller always needs
  (`project_name`, `environment_name`, `deploy_path`, `reset_database`, `run_seeders`,
  `health_url` override) plus a declarative file for the inherently nested/list-shaped data
  (image definitions, health checks, database block, environment files).

**Decision: C — Hybrid.**

**Rationale**: `workflow_call.inputs` only supports scalar types (`string`, `boolean`, `number`,
`choice`) — there is no native list or object input. Modeling "one or more images" or "zero or
more health checks" as pure inputs forces either a fixed maximum number of numbered inputs
(`image_1_name`, `image_2_name`, ...) or JSON-stringified blobs passed as a single string input,
both of which are harder to read, harder to validate, and harder to diff in a PR than a YAML
file. Conversely, forcing *everything* (including the trigger-adjacent values a human editing
the caller workflow wants to see at a glance, like `reset_database`) into a side file makes the
caller workflow less self-explanatory and duplicates what `workflow_dispatch.inputs` already
needs to declare anyway for the GitHub UI checkbox/text prompts. Hybrid keeps the caller
workflow's `with:` block legible for the "always there" knobs and moves the genuinely
variable-shaped data into one reviewable YAML file per environment. This matches the shape the
user's own conceptual example already used.

**Consequence**: `deploy-stack.yml` accepts a `configuration_file` input (default
`.github/deploy/<environment_name>.yml`, validated against a JSON Schema shipped in this repo)
in addition to its scalar inputs. See `docs/adr/0003-config-model.md`.

## Q2: Secrets propagation — explicit `secrets:` map or `secrets: inherit`?

**Context**: `spec.md` FR-042/FR-043; directly shaped by the GitHub Actions secrets research
recorded in `docs/secrets-and-environments.md`.

**Options considered**:
- **A — Explicit map at every call site**: caller lists every secret name it forwards.
- **B — `secrets: inherit`**: caller forwards everything it has access to.
- **C — Hybrid**: caller uses `secrets: inherit` (simplicity), but the reusable workflow still
  declares every secret it can use, by name, in `on.workflow_call.secrets` with
  `required: true/false`, and runtime-validates each one before first use.

**Decision: C — Hybrid**, for the current personal-account, single-trusted-maintainer
situation; **A is the recommended switch once any repository moves to an organization** or gains
collaborators who shouldn't see every secret.

**Rationale**: The load-bearing fact from the GitHub Actions documentation (confirmed live, not
assumed — see `docs/secrets-and-environments.md`) is that secrets configured **in
`reusable-workflows` itself are never available to a caller** — `secrets: inherit` only
forwards secrets the *caller's own job* already has (its repo secrets, and org/environment
secrets if it has any). So `inherit` cannot over-expose beyond what the calling repository
(e.g. Pricely) already grants its own workflow runs; it just saves re-typing ~10 secret names
per caller. Because every current and near-term caller is a solo-maintained personal repository
with no other collaborators, the risk `inherit` is meant to guard against (a less-trusted
caller silently getting secrets it shouldn't) does not yet exist. Declaring every secret by name
in the reusable workflow's own contract (Option A's benefit) is kept anyway, as documentation
and as a fail-fast runtime check — this is not a GitHub-enforced restriction, but it means a
misconfigured caller gets "Missing required secret: DEPLOY_SSH_KEY" instead of an opaque SSH
failure three steps later.

**Consequence**: `docs/secrets-and-environments.md` documents both the personal-account
strategy (this decision) and the organization-scenario recommendation (switch to explicit
`secrets:` maps and move shared infra secrets to org/environment secrets with per-repo access
policies). See `docs/adr/0002-secrets-strategy.md`.

## Q3: Rollback — automatic or manual?

**Context**: `spec.md` Assumptions/Edge Cases; the user explicitly asked to evaluate automatic
rollback feasibility and explicitly forbade shipping an unsafe automatic rollback just to check
a box.

**Options considered**:
- **A — Fully automatic rollback**: on health-check failure, redeploy the previously-running
  image tag automatically.
- **B — Manual rollback only**: the platform preserves everything a human needs (previous image
  tag, unremoved pre-deploy backup, deploy summary) but never redeploys on its own.
- **C — Automatic rollback of containers only, never of the database.**

**Decision: B — Manual rollback only** for v1.

**Rationale**: Migration and reset commands are caller-supplied and opaque to the platform
(Principle VIII/IX — the platform must stay generic); it cannot know whether a given migration
is safely reversible. Automatically redeploying an older container image after a migration has
already altered the schema (Option C) risks running old application code against a newer schema
— often a worse failure mode than the original one, and exactly the kind of "automatic rollback
that is unsafe just to satisfy the requirement" the brief explicitly ruled out. A fully automatic
rollback (Option A) inherits the same problem. Because backups are already taken, verified, and
retained *before* every migration/reset (FR-019/FR-020), and because the previous image
reference is captured in the run summary and a preserved `.env.previous` copy on the server
(new in this platform; the current Pricely workflow does not keep this), a human has everything
needed to roll back deliberately in minutes, with full context.

**Consequence**: `deploy-compose` (composite action) MUST snapshot the server's current
`.env`/compose state to `.env.previous`/`docker-compose.previous.yml` before overwriting it, and
the deploy summary MUST include the previous and new image references plus the backup file path.
`docs/rollback.md` documents the manual procedure step by step. Automatic rollback is recorded
as an explicit non-goal, not a silent omission. See `docs/adr/0006-rollback-strategy.md`.
