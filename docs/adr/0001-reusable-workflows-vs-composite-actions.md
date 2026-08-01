# ADR 0001: Reusable Workflows for Orchestration, Composite Actions for Steps

**Status**: Accepted — 2026-08-01

## Context

The previous version of this repository put an entire multi-job deploy sequence (Tailscale, SSH,
upload, remote script, health check, notify) inline inside one reusable workflow
(`docker-deploy-ssh.yml`). That made each step untestable in isolation and forced any reuse of a
sub-part (e.g. "just set up SSH") to copy-paste YAML rather than reference it.

## Decision

- **Reusable workflows** (`.github/workflows/*.yml` with `on: workflow_call`) are used only for
  **orchestration**: declaring the job graph, `needs:` ordering, `if:` gating (e.g. skip DB steps
  when disabled), concurrency, and top-level permissions.
- **Composite actions** (`.github/actions/*/action.yml`) own every actual unit of work: one
  action per concern (`setup-ssh`, `backup-postgres`, `health-check`, etc.), each independently
  testable with Bats against local fixtures/mocks.
- A reusable workflow's job is a sequence of `uses: ./.github/actions/<name>` steps with data
  flowing through step outputs (and one JSON-string output where a composite action's result is
  itself a small structured record, since composite action outputs are scalar strings).

## Consequences

- Adding a new deploy target type (e.g. a project with no database) means the orchestrating
  workflow gains an `if:` on existing actions, not new duplicated shell.
- Composite actions can be unit-tested with Bats without spinning up an entire workflow run.
- Slightly more files to navigate than one monolithic YAML; judged worth it given the previous
  monolith is exactly what produced the duplication problem this rewrite exists to fix.
- Composite actions cannot call reusable workflows (a GitHub Actions platform limitation), so
  this structure caps nesting depth at 1, well under the platform's 10-level limit (see
  `specs/001-reusable-ci-platform/research.md` R2).
