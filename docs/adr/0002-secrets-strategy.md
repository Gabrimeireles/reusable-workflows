# ADR 0002: Secrets Live in the Caller, Not in This Repository

**Status**: Accepted — 2026-08-01

## Context

A natural but incorrect assumption when centralizing CI/CD is that secrets can also be
centralized in the repository hosting the reusable workflows. This was explicitly checked
against current GitHub Actions documentation before designing anything (see
`specs/001-reusable-ci-platform/research.md` R1): a reusable workflow never has access to
secrets defined in its own hosting repository unless its caller happens to also be that same
repository. A caller's job only forwards secrets it already possesses — from its own repository
secrets, and (only in an Organization) org or environment secrets — via an explicit `secrets:`
map or `secrets: inherit`.

Both `Gabrimeireles/reusable-workflows` and `Gabrimeireles/Pricely` are public repositories owned
by the personal account `Gabrimeireles` (verified via `gh api repos/.../{repo}` — not an
organization, no enterprise). There is no "organization secret" concept available today.

## Decision

1. **This repository never stores or assumes any secret of its own.**
2. Every secret a reusable workflow can use is declared explicitly, by name, in that workflow's
   `on.workflow_call.secrets`, each marked `required: false` at the GitHub Actions level (so a
   caller that doesn't need a given feature — e.g. Tailscale — doesn't have to supply its
   secrets), but validated as conditionally required at runtime based on which features the
   caller's config actually enables (e.g. `use_tailscale: true` requires
   `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET`).
3. Callers use `secrets: inherit` at the `uses:` call site. This is safe *today* specifically
   because every caller is a solo-maintained personal repository — `inherit` cannot expose a
   secret beyond what that repository's own workflow runs already have access to; it only saves
   re-declaring ~10 secret names per call site.
4. Each consumer repository (Pricely, and every future project) holds its own copy of every
   infrastructure secret (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `GHCR_PAT`,
   `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`) and every application secret (DB password, per-app
   env file contents) as repository secrets.

## Organization scenario (documented now, not required for v1)

If any of these repositories move into a GitHub Organization:
- Shared infrastructure secrets (`DEPLOY_HOST`, `GHCR_PAT`, Tailscale credentials, etc. — if
  multiple projects genuinely share one deploy host) become **organization secrets** scoped via
  "selected repositories" to only the repos that need them, rather than copy-pasted per repo.
- Application-specific secrets stay per-repository or move to **environment secrets** so a
  `production` environment can require reviewer approval before a job that references
  `environment: production` can read them.
- Switch callers from `secrets: inherit` to an **explicit `secrets:` map** — with more
  repositories and potentially more collaborators/less trust per repository, `inherit`'s "you get
  everything I have" behavior is no longer appropriate; explicit maps make the exposure list
  reviewable in the caller's own diff.
- Consider making `reusable-workflows` **internal** visibility (org-only) instead of public,
  once "anyone on the internet can read our deploy logic" is no longer an acceptable tradeoff —
  this repository's genericness (Principle VIII) is exactly what makes that safe to do without a
  functional change.

Full walkthrough: `docs/secrets-and-environments.md`.

## Consequences

- No secret ever needs to exist in this repository, which also means this repository's own CI
  (`ci.yml`) never needs production credentials to test itself (Principle X).
- A misconfigured caller gets a clear "Missing required secret: X" failure from the runtime
  validation, not a generic downstream SSH/curl error.
- The security ceiling in the personal-account phase is "as strong as the weakest caller
  repository's own secret hygiene" — acceptable for a single trusted maintainer, explicitly
  flagged as the thing to revisit before adding collaborators or moving to an organization.
