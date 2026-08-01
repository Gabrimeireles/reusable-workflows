# ADR 0003: Hybrid Configuration — Scalar Inputs + Declarative File

**Status**: Accepted — 2026-08-01

## Context

`spec.md` requires supporting monorepos with N images, 0..N health checks, optional database
config, and a variable list of environment files. `on.workflow_call.inputs` only supports
scalar types (`string`, `boolean`, `number`); there is no array/object input.

## Options considered

- **A — Inputs only**: numbered inputs (`image_1_name`, `image_2_name`, ...) or a single
  JSON-stringified input for everything list-shaped.
- **B — Declarative file only**: one `configuration_file` input, everything else lives there,
  including things like `reset_database` that a maintainer wants to see and toggle right in the
  caller workflow's `with:`/`workflow_dispatch.inputs` block.
- **C — Hybrid**: scalar inputs for the values every caller always needs and that benefit from a
  native `workflow_dispatch` UI control (`project_name`, `environment_name`, `reset_database`,
  `run_seeders`, `health_url_override`), plus a declarative YAML file for the list/nested data
  (images, health checks, database block, env files).

## Decision

Option C. Numbered inputs (Option A) don't scale and produce ugly, hard-to-diff call sites for
anything beyond 2 images. Pure-file (Option B) loses the native `workflow_dispatch` checkbox/text
UI for the two inputs a human actually wants to toggle by hand (`reset_database`, `run_seeders`)
and makes the caller workflow less self-explanatory at a glance.

The declarative file:
- Lives in the caller's own repository at `.github/deploy/<environment_name>.yml` by default
  (overridable via the `configuration_file` input).
- Is validated by the `load-config` composite action against
  `specs/001-reusable-ci-platform/contracts/config.schema.json` before any deploy step runs.
- Is intentionally a flat, single-purpose format (no templating language, no `!include`, no
  environment-variable interpolation of its own) — see "no overengineering" in the constitution;
  GitHub Actions expressions (`${{ }}`) already provide the one level of dynamism actually needed
  (e.g. choosing which environment's file to load).

## Consequences

- `deploy-stack.yml`'s `with:` block stays short and readable for the values a human toggles.
- Monorepo/multi-image/multi-health-check support doesn't require inventing numbered inputs or
  raising them each time a project needs one more image.
- Adds one moving part (a config file + its schema + its validator) that must be kept in sync;
  mitigated by `tests/unit/validate-config.test.mjs` running the validator against
  `tests/fixtures/config/{valid,invalid}/*.yml` in CI.
