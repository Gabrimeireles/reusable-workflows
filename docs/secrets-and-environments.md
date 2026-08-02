# Secrets & Environments

## The one rule that shapes everything here

**A secret defined in `Gabrimeireles/reusable-workflows` is never available to a caller.**
GitHub Actions only forwards secrets that the *caller's own job* already has access to — its own
repository secrets, and (in an Organization) org/environment secrets — either via an explicit
`secrets:` map or via `secrets: inherit`. This was verified directly against current GitHub
documentation while designing this platform (not assumed); see
[`specs/001-reusable-ci-platform/research.md`](../specs/001-reusable-ci-platform/research.md) R1.

## Why `secrets: inherit` isn't used here

Two additional, verified constraints ruled it out once the declarative config let a project name
its own environment-file secrets (`BACKEND_ENV_FILE`, `WEB_ENV_FILE`, ...):

1. `secrets: inherit` and an explicit `secrets:` map are **mutually exclusive** on one `uses:`
   call — a caller must pick one for the entire call, not mix them.
2. Even under `inherit`, a called workflow can only reference a secret via a **static, literal**
   `${{ secrets.NAME }}` expression — there is no dynamic/computed lookup
   (`secrets[configValue]` does not work). A reusable workflow can never "read whatever secret
   name a project's config happens to mention."

Full writeup: [`specs/001-reusable-ci-platform/analysis-report.md`](../specs/001-reusable-ci-platform/analysis-report.md)
Finding 1, and [`docs/adr/0002-secrets-strategy.md`](adr/0002-secrets-strategy.md).

## What this platform actually does

- `deploy-stack.yml` declares every secret it can use by name in `on.workflow_call.secrets`:
  `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `GHCR_PAT`, `TS_OAUTH_CLIENT_ID`,
  `TS_OAUTH_SECRET`, `COMPOSE_ENV_EXTRA`, and six generic positional slots `ENV_FILE_1` ..
  `ENV_FILE_6`.
- Callers use an **explicit `secrets:` map**, renaming their own human-named secrets onto these
  slots:
  ```yaml
  secrets:
    DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
    ENV_FILE_1: ${{ secrets.BACKEND_ENV_FILE }}
    ENV_FILE_2: ${{ secrets.WEB_ENV_FILE }}
  ```
- Every consumer repository holds its own copies of every secret it needs. This platform stores
  none of them.
- `COMPOSE_ENV_EXTRA` holds the caller's full Compose `.env` content minus the image/tag lines
  the platform derives itself — database password, ports, URLs, feature flags, whatever the
  caller's own Compose file references. See [`docs/architecture.md`](architecture.md).

## Personal account (current situation)

`Gabrimeireles/reusable-workflows`, `Pricely`, `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, and
`Conecta_SLA` are all public repositories owned by the personal user account `Gabrimeireles` —
verified via `gh api repos/.../{repo}`, not assumed. There is no organization-secret concept
available. Each repository:

- Holds its own infrastructure secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
  `GHCR_PAT`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`) as repository secrets, even when the
  underlying deploy host is shared across projects (each repo just gets its own copy of the same
  value — small duplication, acceptable at this scale).
- Holds its own application secrets (`COMPOSE_ENV_EXTRA`, `ENV_FILE_1..6` sources) as repository
  secrets.
- Uses `Gabrimeireles/reusable-workflows` being **public** to call its workflows/composite
  actions without any cross-repo access configuration — public reusable workflows are callable
  from any repository.

The security ceiling here is "as strong as the weakest caller repository's own secret hygiene" —
acceptable with a single trusted maintainer across every caller repository, and explicitly the
thing to revisit before adding collaborators.

## If/when this moves to a GitHub Organization

- Shared infrastructure secrets used by more than one project on the same deploy host (e.g.
  `GHCR_PAT`, Tailscale credentials) become **organization secrets**, scoped via "selected
  repositories" to exactly the repos that need them — removing the current copy-per-repo
  duplication.
- Application-specific secrets stay per-repository, or move to **environment secrets** scoped to
  a named GitHub Environment (e.g. `production`) so that environment's required-reviewer
  protection gates any job referencing it.
- The explicit `secrets:` map pattern used today needs **no change** — it was already chosen
  with this scenario in mind, unlike `secrets: inherit`, which would have needed replacing.
- Consider setting `reusable-workflows`'s visibility to **internal** (org-only) instead of
  public, once "readable by anyone on the internet" is no longer acceptable — the platform's
  genericness (Constitution Principle VIII) is exactly what makes that a non-functional change.
- A job inside `deploy-stack.yml` can declare `environment: <name>` to gate on a caller-defined
  GitHub Environment (resolved against the *caller's* repository) — useful for requiring manual
  approval before a `reset_database=true` run, without any change needed in this repository. See
  [`specs/001-reusable-ci-platform/research.md`](../specs/001-reusable-ci-platform/research.md) R4.

## What is never allowed, regardless of account type

- No step prints a secret value to logs.
- No step writes a secret value to `$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY`, or any artifact.
- Every secret-derived file on disk (local runner or remote host) is created with `umask 177`
  and deleted in the same job/script once no longer needed.
- `tests/bats/no-project-literals.bats` includes a grep-based check for the most common
  secret-leak patterns as a regression guard.
