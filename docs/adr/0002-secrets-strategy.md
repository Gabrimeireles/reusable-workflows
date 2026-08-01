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

Both `Gabrimeireles/reusable-workflows` and `Gabrimeireles/Pricely` — and, as discovered during
`/speckit.analyze` (see `specs/001-reusable-ci-platform/analysis-report.md` Finding 2), three
other active consumers, `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, and `Conecta_SLA` — are
public repositories owned by the personal account `Gabrimeireles` (verified via `gh api
repos/.../{repo}` — not an organization, no enterprise). There is no "organization secret"
concept available today.

A first draft of this ADR proposed `secrets: inherit` at every call site. That was superseded
(`clarify-log.md` Q2) once verifying GitHub's actual behavior showed `secrets: inherit` is
mutually exclusive with an explicit `secrets:` map on the same call, and that even under
`inherit` a called workflow can only reference a secret via a static literal name — it cannot
dynamically look up whatever secret name a project's declarative config happens to mention. Since
`docs/adr/0003-config-model.md` lets each project name its own environment-file secrets
(`BACKEND_ENV_FILE`, `WEB_ENV_FILE`, ...), the platform needs a mechanism that doesn't require
dynamic lookup — which explicit mapping provides for free.

## Decision

1. **This repository never stores or assumes any secret of its own.**
2. Every secret a reusable workflow can use is declared explicitly, by name, in that workflow's
   `on.workflow_call.secrets`: the fixed infrastructure secrets (`DEPLOY_HOST`, `DEPLOY_USER`,
   `DEPLOY_SSH_KEY`, `GHCR_PAT`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `POSTGRES_PASSWORD`,
   ...) plus six generic, positional slots — `ENV_FILE_1` through `ENV_FILE_6` — for environment
   files, each marked `required: false` at the GitHub Actions level (so a caller that doesn't
   need a given feature doesn't have to supply its secrets), but validated as conditionally
   required at runtime based on which features the caller's config actually enables (e.g.
   `use_tailscale: true` requires `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET`; the *i*-th
   `environmentFiles` config entry requires `ENV_FILE_<i>` to be non-empty when `required: true`).
3. **Callers use an explicit `secrets:` map** at the `uses:` call site — not `inherit` — renaming
   their own human-named secrets (e.g. `BACKEND_ENV_FILE`) onto the fixed slot names
   (`ENV_FILE_1`) the reusable workflow expects. This is the only mechanism compatible with both
   the mutual-exclusivity constraint and letting each project keep human-readable secret names in
   its own repository Settings page.
4. Each consumer repository (Pricely, and every future project) holds its own copy of every
   infrastructure secret and every application secret (DB password, per-app env file contents) as
   repository secrets.

## Organization scenario (documented now, not required for v1)

If any of these repositories move into a GitHub Organization:
- Shared infrastructure secrets (`DEPLOY_HOST`, `GHCR_PAT`, Tailscale credentials, etc. — if
  multiple projects genuinely share one deploy host) become **organization secrets** scoped via
  "selected repositories" to only the repos that need them, rather than copy-pasted per repo.
- Application-specific secrets stay per-repository or move to **environment secrets** so a
  `production` environment can require reviewer approval before a job that references
  `environment: production` can read them.
- The platform already uses an explicit `secrets:` map (see Decision above), so no change is
  needed here on that front. What changes in an organization is *where the secret lives*: shared
  infrastructure secrets move to **organization secrets** scoped via "selected repositories," and
  environment-gated secrets become available for reviewer-approval workflows.
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
  repository's own secret hygiene" — acceptable for a single trusted maintainer across multiple
  caller repositories, explicitly flagged as the thing to revisit before adding collaborators or
  moving to an organization.
- A caller workflow's `secrets:` block is a few lines longer than a bare `secrets: inherit`
  would have been; judged a worthwhile, one-time cost for a contract that needs no future
  migration and stays fully self-documenting in every caller's own diff.
