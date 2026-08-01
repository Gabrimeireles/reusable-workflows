# ADR 0005: Project-Specific Commands Are Opaque Strings the Caller Owns

**Status**: Accepted — 2026-08-01

## Context

Pricely's real migration/reset/seed commands are Prisma+npm-specific
(`npm run db:generate && npm run db:migrate:deploy:safe`, etc. — verified in
`Pricely/backend/package.json`, not assumed). A future project might use a different ORM, a
different language, or no migration tool at all. Principle VIII forbids hardcoding any of this
centrally.

## Decision

`run-database-command` (composite action) takes a `command` string and a `service` name and
does exactly one thing: `docker compose exec -T <service> sh -lc "<command>"` (or `run --rm -T`
for reset/seed, which may need the service not already running), with the command passed via an
environment variable and `sh -lc "$COMMAND"` rather than direct `${{ }}` interpolation into the
`run:` block, to avoid command-injection through a malicious/malformed command string (Principle
II). The reusable workflow never inspects, parses, or special-cases the command's content — it
is an opaque string from the caller's declarative config's `database.migration.command` /
`database.reset.command` / `database.seed.command` fields.

This makes the platform tool-agnostic: a future project using Django migrations, Rails
migrations, or a hand-rolled SQL script supplies its own command string with zero central
changes.

## Consequences

- The platform cannot validate that a command is "safe" beyond structural checks (no shell
  metacharacter escaping needed because the whole string is treated as one opaque shell command
  by design — the caller who wrote it is the same trust boundary as the caller who wrote their
  own Dockerfile, so this is not a new privilege escalation).
- Reset remains gated by Principle VII/FR-030 regardless of what the reset command does — the
  gate is on *whether* it runs, not on inspecting its content.
- `docs/caller-contract.md` documents this clearly so a new adopter understands they own their
  own command's idempotency/correctness (Principle VI notes the platform's idempotency guarantee
  stops at "the orchestration doesn't assume a clean slate"; it can't make an arbitrary caller
  command idempotent for them).
