# ADR 0009: Hooks Generalize the Existing Opaque-Command Mechanism

**Status**: Accepted — 2026-08-02

## Context

Iteration 1 already has exactly this pattern for three lifecycle points (migration, reset, seed):
an opaque, caller-owned command run remotely inside a named Compose service via
`run-database-command`, safely, without direct string interpolation (ADR 0005). The brief asks
for nine more lifecycle points, plus `pre_build`/`post_build`, plus the ability for a hook to be
an inline command, a script path, or a plugin default.

## Decision

- **Resolution** (command vs. script vs. plugin) happens once, in the Node config loader (same
  place plugins resolve — ADR 0007), producing one final command string per declared hook before
  `deploy-stack.yml` ever runs. A script path becomes `bash <path>`; a plugin-provided hook is
  substituted if the caller didn't override it. The executor never needs to know which of the
  three a hook came from.
- **Execution split by context**: `pre_build`/`post_build` run on the GitHub-hosted runner
  (inside the `build` job from ADR 0008, before/after the actual `docker build`/push) because the
  remote host isn't part of the picture yet at that point. The other ten
  (`pre_backup`/`post_backup`/`pre_migration`/`post_migration`/`pre_deploy`/`post_deploy`/
  `pre_healthcheck`/`post_healthcheck`/`pre_cleanup`/`post_cleanup`) run remotely, via the same
  safe SSH-stdin-heredoc mechanism already used for migration/reset/seed.
- **Rename**: `run-database-command` → `run-remote-command`. It was already a generic "run this
  opaque command in this Compose service" executor; the name just hadn't caught up. Cheap now
  (zero released consumers of this action's name), not cheap later.
- **Undeclared hook = no-op.** A hook is only ever a no-op or a single resolved command — it is
  never itself a place for conditional logic; that belongs in the command/script the hook points
  to, keeping the executor trivial and testable.

## Consequences

- The twelve hook points are testable with the same Bats approach already proven for
  `run-database-command`/reset-guard: pure logic (resolution order, no-op-when-undeclared)
  tested without any SSH, plus the remote execution path tested against a local mock `sshd`
  container, unchanged from iteration 1's testing approach (Principle X).
- `pre_build`/`post_build` hooks add two `if:`-gated steps to the matrix `build` job (ADR 0008),
  not to `docker-build.yml` itself, since `docker-build.yml` remains independently callable by
  projects that don't use hooks at all.
