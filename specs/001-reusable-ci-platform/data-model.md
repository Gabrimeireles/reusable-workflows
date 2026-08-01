# Phase 1 Data Model: Declarative Deploy Configuration

This models the entities from `spec.md`'s Key Entities as the concrete shape of a caller's
declarative config file (`contracts/config.schema.json` is the enforced version of this).

## Project

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string, `^[a-z][a-z0-9-]{1,48}$` | yes | Used to derive the default deploy path and as a label in logs/summaries. |
| `deployPath` | string, absolute path | no | Defaults to `/srv/stacks/<name>`. If provided, MUST resolve under the configured base directory (default `/srv/stacks`) with no `..` segments. |

## Image definition (list, 1..N)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string, `^[a-z][a-z0-9-]{0,31}$` | yes | Used as the GHA job/output key and as the Compose service's image-var prefix (e.g. `BACKEND_IMAGE`). |
| `name` | string | yes | Image name without registry, e.g. `pricely-backend`. |
| `context` | string, relative path | yes | Docker build context. |
| `dockerfile` | string, relative path | yes | Path to the Dockerfile. |
| `buildArgs` | map[string]string | no | Non-secret build args only (enforced: no key may match a secret-looking pattern; see `docs/adr/0005`). |

## Compose

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string, relative path in caller repo | yes | e.g. `docker-compose.homolog.yml`. |
| `destination` | string, filename only (no path separators) | no | Defaults to `docker-compose.yml` on the server. |
| `dependencyServices` | string[] | no | Services started before migration (e.g. `postgres`, `redis`, `pgadmin`). |
| `applicationServices` | string[] | no | Services recreated after migration (e.g. `backend`, `web`). Defaults to all image `id`s. |

## Environment files (list, 0..N)

| Field | Type | Required | Notes |
|---|---|---|---|
| `secret` | string | yes | Name of the caller secret holding the file's full contents. |
| `destination` | string, filename only | yes | e.g. `.env.backend`. |
| `required` | boolean | no, default `true` | If `true` and the secret is empty, the run fails before upload. |

## Database configuration (optional block)

| Field | Type | Required | Notes |
|---|---|---|---|
| `enabled` | boolean | yes | If `false`, every field below is ignored and all DB steps are skipped. |
| `engine` | `"postgres"` (only supported value for v1) | yes | |
| `composeService` | string | yes | Service name providing the database, e.g. `postgres`. |
| `containerDatabase` | string | yes | Database name inside the container, used for `pg_dump`/`pg_isready`. |
| `containerUser` | string | no, default `postgres` | |
| `backup.enabled` | boolean | no, default `true` | |
| `backup.retentionDays` | number ≥ 1 | no, default `14` | |
| `migration.service` | string | yes | Compose service the migration command runs inside. |
| `migration.command` | string | yes | Free-form shell command, caller-owned (Principle IX). |
| `reset.command` | string | no | Required only if reset is ever requested; absent means reset is unsupported for this project. |
| `seed.command` | string | no | Required only if seeding is ever requested. |

## Health checks (list, 0..N)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Label used in logs/summary. |
| `type` | `"http"` \| `"compose"` | yes | |
| `url` | string (http type only) | conditionally | |
| `service` | string (compose type only) | conditionally | |
| `command` | string (compose type only) | conditionally | Run inside `service` via `docker compose exec`. |
| `retries` | number ≥ 1 | no, default `10` | |
| `intervalSeconds` | number ≥ 1 | no, default `10` | |

## Deploy run record (produced, not configured)

Written to `$GITHUB_STEP_SUMMARY` and as job outputs by `deployment-summary`:

| Field | Source |
|---|---|
| `project`, `environment` | resolved inputs |
| `images[].name`, `images[].tag`, `images[].digest` | `docker-build.yml` outputs |
| `previousImages[]` | read back from the server's `.env.previous` snapshot before overwrite |
| `migrationRan`, `resetRan`, `seedRan` | booleans reflecting what actually executed |
| `backupFile` | path written by `backup-postgres` |
| `healthChecks[].name`, `.outcome` | results from `health-check` |
| `durationSeconds` | wall-clock of the `deploy` job |
