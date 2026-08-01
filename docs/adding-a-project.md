# Adding a New Project

This is the path every new personal project should follow. It does not require reading anything
under `.github/` in this repository.

## 1. Provision the server side (once per project)

- Create `/srv/stacks/<project_name>` is **not** something you do manually — `deploy-stack.yml`
  creates it automatically on first deploy. You only need SSH access for the deploy user and
  Docker + Docker Compose v2 installed on the target host.
- Decide whether this project uses Tailscale to reach the host, or connects directly.

## 2. Write the declarative config

Create `.github/deploy/<environment>.yml` in your project (e.g. `.github/deploy/homolog.yml`).
Start from `tests/fixtures/config/valid/single-image.yml` (no database) or
`tests/fixtures/config/valid/pricely-homolog.yml` (full example with database + health checks)
in this repository, and adjust. Full field reference: [`docs/caller-contract.md`](caller-contract.md).

## 3. Add secrets to your repository

At minimum: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `GHCR_PAT`. If your Compose file
needs any variables the platform doesn't derive itself (which is almost certainly true — at
least a database password), add `COMPOSE_ENV_EXTRA` with the rest of your `.env` content. If you
have application env files (`.env.backend`, etc.), add one secret per file and note their names
— you'll reference them positionally in your caller workflow (`ENV_FILE_1`, `ENV_FILE_2`, ...).
If you use Tailscale, add `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET`.

## 4. Write the caller workflow

Copy the example in the main [`README.md`](../README.md#minimal-caller-example) and adjust
`image_name`, `dockerfile`, `context`, `project_name`, `environment_name`, and the `secrets:`
map. Keep the `secrets:` map explicit (not `secrets: inherit` — see
[`docs/secrets-and-environments.md`](secrets-and-environments.md)).

## 5. (Optional) Add a config-validation PR check

```yaml
name: Validate deploy config

on:
  pull_request:
    paths: [".github/deploy/**"]

permissions:
  contents: read

jobs:
  validate:
    uses: Gabrimeireles/reusable-workflows/.github/workflows/validate-caller.yml@v1
    with:
      project_name: myapp
      environment_name: homolog
```

## 6. First deploy

Push to your default branch, or run the workflow via `workflow_dispatch`. Read the run's step
summary — it lists images, database actions taken, and health-check outcomes. If something's
wrong, see [`docs/troubleshooting.md`](troubleshooting.md).

## What you get for free, without writing any of it yourself

Tailscale connection (optional), SSH setup with host-key pinning, GHCR authentication on the
remote host, safe file upload with automatic cleanup, dependency-service startup, database
backup + verification + retention, migration (and gated reset/seed), service recreation, health
checks, image pruning, and a run summary. None of this needs to exist in your repository.
