# ADR 0006: Manual Rollback Only, With Preserved Artifacts

**Status**: Accepted — 2026-08-01

## Context

The brief explicitly asked for a rollback strategy evaluation and explicitly forbade an unsafe
automatic rollback shipped just to satisfy the requirement. See
`specs/001-reusable-ci-platform/clarify-log.md` Q3 for the full options analysis.

## Decision

**No automatic rollback in v1.** Instead, every deploy run guarantees the preconditions for a
fast, deliberate manual rollback:

1. **Immutable tags** (ADR-independent, already required by Principle V) mean any previously
   deployed image reference can always be re-pulled and re-run exactly as it was.
2. **`deploy-compose` snapshots state before overwriting it**: before writing the new `.env` /
   compose file to the server, it copies the currently-deployed `.env` to `.env.previous` and the
   currently-deployed compose file to `docker-compose.previous.yml`, so "what was running before"
   is one `docker compose --env-file .env.previous -f docker-compose.previous.yml up -d` away.
3. **Backups are taken and verified before every migration/reset, and never deleted by the
   current run** — retention (`FR-020`) only prunes backups older than the configured window, so
   the backup that precedes the run that just happened is always available.
4. **The deploy summary records everything a human needs**: previous vs. new image references,
   whether migration/reset/seed ran, and the exact backup file path — so a rollback decision
   doesn't require reconstructing history from raw logs.
5. **`docs/rollback.md`** documents the manual procedure step by step (restore previous
   compose/env, optionally `pg_restore` the preserved backup, recreate services, re-run health
   check) so it does not need to be reinvented under pressure during an incident.

## Why not automatic

An automatic rollback that only reverts containers (not the database) risks running old
application code against a migrated schema — a strictly worse failure than the one it's trying
to fix, because the platform cannot know whether a caller's migration is safe to leave applied
after reverting the app. An automatic rollback that also tries to revert the database would
require the platform to understand and safely reverse an opaque, caller-owned migration command
(ADR 0005) — not something a generic platform can do correctly for arbitrary tools. Both paths
trade a knowable, human-diagnosable failure for a worse, silent one, which Principle VII/the
brief's explicit instruction rule out.

## Consequences

- Recovery time after a bad deploy depends on a human noticing and acting, not on automation —
  acceptable for a personal-projects platform where deploys are infrequent and monitored by the
  same person who triggered them.
- Revisit if/when this platform grows beyond a single trusted operator watching each deploy (e.g.
  add a monitored rollback runbook trigger, or a narrowly-scoped automatic *container-only*
  rollback for stacks that declare "no destructive migrations ever" — explicitly out of scope
  now, not designed away permanently).
