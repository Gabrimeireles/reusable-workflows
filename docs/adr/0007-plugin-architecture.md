# ADR 0007: Plugins Are Node Modules Resolved by the Config Loader, Not Dynamic Workflows

**Status**: Accepted — 2026-08-02

## Context

The brief asks for a plugin system (`plugins/{nestjs,laravel,prisma,drizzle,vite,nextjs,react,
postgres,mysql,redis}/`) where each plugin can add validations, defaults, hooks, health checks,
and commands, without modifying the reusable workflow — and where the workflow "just loads
declared plugins."

The natural first instinct — a composite action per plugin, dynamically `uses:`-referenced by
name — does not work: GitHub Actions' `uses:` key is a static string; it cannot contain an
expression (verified against current GitHub Actions behavior, not assumed). There is no
`uses: ./.github/plugins/${{ matrix.plugin }}/action.yml`.

## Decision

A plugin is a directory `.github/plugins/<name>/plugin.mjs` exporting a plain object:
`{ name, defaults, validate(config), hooks, healthChecks }`. `.github/scripts/validate-config.mjs`
(already the single place that parses and validates the declarative config — ADR 0003) resolves
each name in the caller's `plugins: [...]` list with a normal Node.js dynamic `import()`, in
declaration order:

1. Deep-merge `defaults` under the config — **the caller's own value always wins**; a plugin
   only fills a field the caller left unset. Later-declared plugins merge after earlier ones, so
   with two plugins defaulting the same field, the later declaration wins unless the config
   itself already set it.
2. Run `validate(config)` for additional, plugin-specific semantic checks (e.g. "postgres
   requires `database.engine: postgres`").
3. Fold `hooks`/`healthChecks` into the config the same way, so a plugin can supply a default
   `pre_migration` hook or a default health-check template, again only where the caller hasn't
   already specified one.

The output remains the same single JSON blob `deploy-stack.yml` already consumes via
`fromJSON()` — **no reusable workflow or composite action changes when a plugin is added**,
satisfying Constitution Principle XVI. `import()` runs entirely inside the Node process that
already exists for validation; it introduces no new dependency and no network access (plugin
files are checked out with the rest of the repository, the same way composite actions already
are).

## Consequences

- Adding a plugin: one new file + a fixture test. Zero risk of the change class that made
  iteration 1's "env-file secret naming" design fail (§ ADR 0002) — plugins never touch GitHub
  Actions' static `uses:`/`secrets:` resolution at all, they only produce data.
- A plugin cannot add a *new secret*, a *new remote step type*, or anything requiring a new
  composite action — it can only parametrize the mechanisms that already exist (opaque hook
  commands, config defaults, validation). This is a deliberate limitation: it keeps the plugin
  surface small and auditable, and matches what real plugins in the initial set actually need
  (framework/ORM/database *conventions*, not new infrastructure primitives). If a future plugin
  genuinely needs a new mechanism, that mechanism should be built as a first-class composite
  action first, then made available for plugins to default into — not the other way around.
- Plugin discovery is a fixed, versioned directory in this repository, not a separate registry —
  appropriate at "dozens of projects, one maintainer" scale (Principle "no overengineering");
  revisit only if plugins need to be contributed by parties who shouldn't need write access to
  this repository.
