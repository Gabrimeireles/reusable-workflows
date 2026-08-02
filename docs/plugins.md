# Plugins

Plugins let a project opt into sane, tested defaults for a common stack (a database engine, an
ORM, a frontend framework) instead of writing every config field by hand — without ever changing
a reusable workflow or composite action to support a new one.

## Why plugins aren't GitHub Actions files

The obvious design — a composite action per plugin, loaded dynamically by name — doesn't work on
this platform: GitHub Actions' `uses:` key cannot contain an expression. There is no
`uses: ./.github/plugins/${{ matrix.plugin }}/action.yml`. See
[`docs/adr/0007-plugin-architecture.md`](adr/0007-plugin-architecture.md) for the full reasoning.

Instead, a plugin is a plain JavaScript module resolved by the **Node config loader**
(`.github/scripts/validate-config.mjs`, via `.github/scripts/lib/plugin-loader.mjs`) — the same
process that already parses and validates your `.github/deploy/<environment>.yml`. Because this
is ordinary Node.js `import()`, not GitHub Actions YAML, it has no such restriction.

## Using a plugin

```yaml
plugins: [postgres, prisma, vite]
```

Each declared plugin can contribute:
- **`defaults`** — config values filled in only where you haven't already set them. Your own
  config always wins (see resolution order below).
- **`hooks`** — default commands for the twelve lifecycle hooks (see
  [`docs/hooks.md`](hooks.md)), same override rule.
- **`healthChecks`** — default health check entries, same override rule.
- **`validate(config)`** — extra checks specific to that plugin (e.g. "the `postgres` plugin
  requires `database.engine: postgres`"), reported the same way as any other config error.

## Resolution order

1. Plugins are applied in the order you declare them. If two plugins default the same field,
   the **later-declared one wins** — for anything you haven't already set yourself.
2. Your own config value **always** wins over every plugin default, no matter the order.
3. For array fields (like `healthChecks` or `compose.dependencyServices`), plugin-contributed
   entries are **unioned** (deduplicated) across plugins — but only when you haven't declared
   that field at all yourself. The moment you declare it, your array replaces every plugin
   contribution for that field entirely.

## Shipped plugins

| Plugin | Contributes |
|---|---|
| `postgres` | `database.enabled: true`, `engine: postgres`, `composeService: postgres`, `containerUser: postgres`, `backup: {enabled: true, retentionDays: 14}`; validates `database.engine` isn't set to something else |
| `redis` | `compose.dependencyServices: [redis]` |
| `prisma` | `database.migration/reset/seed.command` (`npx prisma migrate deploy` / `migrate reset --force --skip-seed` / `db seed`), a `pre_migration` hook (`npx prisma generate`); validates `database.migration.service` is set (which Compose service runs it is always project-specific) |
| `nestjs` | A default `compose`-type health check assuming a service named `backend` serving `/health` on port 3000 |
| `nextjs` | A default `compose`-type health check assuming a service named `web` on port 3000 |
| `vite` | A default `compose`-type health check assuming a service named `web` on port 5173 (the exact convention Pricely's own homolog config uses) |

**Not shipped**: a `mysql` plugin was planned but dropped — `backup-postgres` and the schema's
`database.engine` only support Postgres today (iteration 1 scope). Shipping a non-functional
`mysql` plugin would have been misleading. Adding real MySQL support (a `backup-mysql` composite
action, `engine: mysql` in the schema) is a legitimate future addition, but it's new scope, not
something this plugin system was blocked on.

The health-check plugins assume a Compose service name convention (`backend`/`web`). If yours
differs, declare `healthChecks` yourself — a fully-specified array in your own config always
wins.

## Writing your own plugin

See [`docs/adding-a-plugin.md`](adding-a-plugin.md).
