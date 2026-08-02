# Pricely Migration Record

Pricely is the reference implementation and first consumer of the reusable CI/CD platform. This
document is the required before/after record, written **before** touching `Pricely`, per the
brief's explicit requirement. The actual migration lands on a separate branch in `Pricely`
(`migrate/reusable-workflows-v1`); the current `deploy-homolog-server.yml` is **not** removed by
this migration.

## 1. Configuration: current → new

| Concern | Current (`deploy-homolog-server.yml`) | New |
|---|---|---|
| Build | `docker-build.yml@<pinned SHA>`, 2 calls (backend, web) | `docker-build.yml@v1`, same 2 calls, add `version_file: ""` (backend/web have no root-relative version file worth tagging with) |
| Deploy orchestration | ~275 lines of inline shell in the caller | `deploy-stack.yml@v1`, one job call |
| Image name/tag resolution | Inline `Resolve GHCR image names` step | `resolve-project` + `image_refs` input (derived from the two `docker-build` jobs' outputs) |
| Tailscale | Inline `tailscale/github-action` step, `if: vars.USE_TAILSCALE == 'true'` | `setup-network` composite action, `use_tailscale` input |
| SSH + known_hosts | Inline `webfactory/ssh-agent` + retried `ssh-keyscan` | `setup-ssh` composite action |
| Compose/env file upload | Inline `scp` of `.deploy/{docker-compose.yml,.env,.env.backend,.env.web}` | `prepare-deploy-files` + `upload-deploy-files` |
| Remote GHCR login, pull, dependency startup | Inline SSH heredoc | `deploy-compose` stage `start` |
| Postgres wait/backup/verify/retention | Inline SSH heredoc | `backup-postgres` |
| Migration / reset / seed | Inline `npm run db:...` commands | `run-remote-command`, commands supplied via `.github/deploy/homolog.yml` |
| Service recreation + image prune | Inline SSH heredoc | `deploy-compose` stage `recreate` |
| Internal + public health checks | Inline loops | Two `health-check` steps (compose + http) from config |
| Summary/diagnostics | `docker compose logs` on web-not-ready only | `deployment-summary` (always), plus per-action failure diagnostics |
| Reset safety | `workflow_dispatch` input only, no hard runtime block | `workflow_dispatch` input **and** a hard runtime guard that fails the run if `reset_database=true` arrives via `push` |
| Rollback support | None (no previous-state snapshot kept) | `.env.previous`/`docker-compose.previous.yml` snapshot before every deploy |

## 2. Secrets that remain in Pricely (repository secrets)

All of these already exist in `Pricely` today (`gh secret list`, verified 2026-08-01) and keep
their exact current values — only how they're wired into the caller workflow changes:

| Secret | Used for |
|---|---|
| `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` | SSH to the homolog host |
| `GHCR_PAT` | Remote GHCR login |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | Tailscale |
| `POSTGRES_PASSWORD` | Compose `.env` (now folded into `COMPOSE_ENV_EXTRA`, see below) |
| `PGADMIN_DEFAULT_PASSWORD` | Compose `.env` (now folded into `COMPOSE_ENV_EXTRA`) |
| `BACKEND_ENV_FILE` | Backend app env file (now wired to `ENV_FILE_1`) |
| `WEB_ENV_FILE` | Web app env file (now wired to `ENV_FILE_2`) |

## 3. New secrets to create in Pricely (manual step — values are not something this migration can generate)

The platform cannot construct these for you: it never had access to the plaintext of your
existing secrets, and secret values must never be printed, derived, or guessed by an automated
process. **You** need to create these using the same values you already use today:

| New secret | Content |
|---|---|
| `COMPOSE_ENV_EXTRA` | Everything the current inline `.env` writer builds *except* `BACKEND_IMAGE`/`WEB_IMAGE`/`IMAGE_TAG` (the platform derives those from `image_refs`). Concretely, one secret with these lines, using your current values: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT_PUBLIC`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `PGADMIN_PORT`, `BACKEND_PORT`, `WEB_PORT`, `WEB_APP_URL`, `CORS_ALLOWED_ORIGINS`, `VITE_API_BASE_URL`, `VITE_ALLOWED_HOSTS`, `VITE_ALLOW_ALL_HOSTS`, `NODE_ENV`. |
| `ENV_FILE_1` | Copy of your current `BACKEND_ENV_FILE` secret's content (positional slot 1 = the first `environmentFiles` entry in `.github/deploy/homolog.yml`, which is `.env.backend`). |
| `ENV_FILE_2` | Copy of your current `WEB_ENV_FILE` secret's content (positional slot 2 = `.env.web`). |

## 4. Variables that remain in Pricely (repository variables)

| Variable | Current use | New use |
|---|---|---|
| `DEPLOY_PATH` (`/srv/stacks/pricely`) | Deploy path | Matches the platform's default (`/srv/stacks/<project_name>`) — can be removed once cut over, or kept as documentation |
| `USE_TAILSCALE` | Gate for Tailscale step | Maps to the new caller workflow's `use_tailscale` input |
| `BACKEND_PORT`, `WEB_APP_URL`, `CORS_ALLOWED_ORIGINS`, `VITE_*` | Compose `.env` values | Folded into the `COMPOSE_ENV_EXTRA` secret content (see above) — GitHub Actions `vars` can't be referenced from within a secret's own value, so these move alongside the other `.env` content |

## 5. Configuration moved to the central platform (no longer Pricely's problem)

Tailscale connection logic, SSH setup + host-key pinning, remote GHCR authentication, file
upload/cleanup mechanics, Postgres wait-for-ready/backup/verify/retention orchestration, service
recreation sequencing, health-check retry loops, image pruning, and summary generation — all now
implemented once in `reusable-workflows`, not per-project.

## 6. New caller workflow (draft — lands as `Pricely/.github/workflows/deploy-homolog-stack.yml`)

`workflow_dispatch`-only at first (no `push` trigger) so it can be validated independently of the
existing, still-active `deploy-homolog-server.yml`. See the actual file in the migration branch
for the final version; shape matches the platform's [`README.md`](../README.md#minimal-caller-example)
example with `project_name: pricely`, `environment_name: homolog`.

## 7. Rollback plan for the migration itself

1. The old `deploy-homolog-server.yml` is **not modified or removed** by this migration — it
   keeps its `push` trigger and keeps deploying exactly as it does today.
2. The new `deploy-homolog-stack.yml` starts as `workflow_dispatch`-only — it cannot fire
   accidentally and cannot race the old workflow.
3. Cutover (a separate, later, deliberate change) is: (a) manually run the new workflow via
   `workflow_dispatch` against homolog, verify the run summary and a manual smoke-test of the
   site; (b) if good, add the `push` trigger to the new workflow and remove it from the old one
   in the same PR; (c) keep the old workflow file in the repo, disabled, for at least one full
   deploy cycle before deleting it, so reverting is a one-line trigger swap, not a file
   resurrection.
4. If the new path ever fails mid-migration: no action needed — the old workflow is still fully
   functional and untouched.

## 8. Functional equivalence checklist (verify before cutover, not before this doc)

- [ ] Two images (backend, web) build and push with an immutable SHA tag.
- [ ] Compose file uploaded matches `docker-compose.homolog.yml` structurally (same services).
- [ ] `.env`, `.env.backend`, `.env.web` land on the server with the same effective content as
      today (compare byte-for-byte via a manual SSH check on a test path first, if possible).
- [ ] Postgres, Redis, pgAdmin start; backup is taken and verified; 14-day retention applied.
- [ ] Migration runs `npm run db:generate && npm run db:migrate:deploy:safe` (verified command,
      not assumed — from `Pricely/backend/package.json`/`prisma/migrate-deploy.js`).
- [ ] Reset (`workflow_dispatch` only) runs `npm run db:generate && npm run db:migrate:reset`.
- [ ] Seed (opt-in) runs `npm run db:seed`.
- [ ] Backend + web services recreate and become healthy.
- [ ] Internal web health check passes (`wget` against `127.0.0.1:5173`, same as today).
- [ ] Public health check against the configured URL passes.
- [ ] Old images pruned.
- [ ] Run summary present and accurate.
