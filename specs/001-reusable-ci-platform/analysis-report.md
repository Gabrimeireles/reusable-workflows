# Cross-Artifact Analysis Report (`/speckit.analyze` equivalent)

**Date**: 2026-08-01
**Scope**: `constitution.md`, `spec.md`, `clarify-log.md`, `plan.md`, `research.md`,
`data-model.md`, `contracts/`, `tasks.md` — checked against each other and against the real
state of `Gabrimeireles/reusable-workflows` and its actual GitHub-side consumers.

## Finding 1 (CRITICAL): dynamic per-project secret names are incompatible with `secrets: inherit`

**Where found**: `clarify-log.md` Q2 (decided `secrets: inherit`) vs. `data-model.md`
"Environment files" (lets a project name its own secret, e.g. `BACKEND_ENV_FILE`) vs.
`contracts/workflow-contracts.md` (already flagged this as unresolved: "looked up dynamically
via `secrets[...]` is not possible in Actions").

**Verification performed**: fetched current GitHub Actions documentation directly (not
assumed): (a) `secrets: inherit` and an explicit `secrets:` map are **mutually exclusive** on
the same `uses:` call — a job must pick one, not both; (b) with `secrets: inherit`, the called
workflow *can* reference a secret by name even if not declared in its own
`on.workflow_call.secrets` — but only because the name is still a **static, literal** token in
the called workflow's YAML (`${{ secrets.LITERAL_NAME }}`); GitHub Actions expressions do not
support computed/dynamic property lookup on the `secrets` context. So a reusable workflow can
never do "look up whatever secret name this project's config happens to mention."

**Impact**: As designed, a caller could not both (a) use `secrets: inherit` for convenience and
(b) let a project name its environment-file secret anything it likes (`BACKEND_ENV_FILE`,
`WEB_ENV_FILE`, ...), because `deploy-stack.yml` has to reference a fixed literal name for every
secret it ever reads.

**Resolution**: Reverse the Q2 decision. `deploy-stack.yml` declares a **fixed, generic set of
six positional secret slots** — `ENV_FILE_1` .. `ENV_FILE_6` — in
`on.workflow_call.secrets`(alongside the infra secrets). The declarative config's
`environmentFiles` list (max 6 entries) maps position → destination filename/required flag; the
*i*-th entry in the list is populated by whatever the caller wires to `ENV_FILE_<i>` in its own
explicit `secrets:` map. Every caller therefore uses an **explicit `secrets:` map** (not
`inherit`) for the call to `deploy-stack.yml`, e.g.:

```yaml
secrets:
  DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
  DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
  DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
  GHCR_PAT: ${{ secrets.GHCR_PAT }}
  TS_OAUTH_CLIENT_ID: ${{ secrets.TS_OAUTH_CLIENT_ID }}
  TS_OAUTH_SECRET: ${{ secrets.TS_OAUTH_SECRET }}
  POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
  ENV_FILE_1: ${{ secrets.BACKEND_ENV_FILE }}
  ENV_FILE_2: ${{ secrets.WEB_ENV_FILE }}
```

This is barely more verbose than `inherit` (a handful of extra lines, once, in a workflow that
already lists its secrets for documentation), keeps each project's own human-readable secret
names in its own Settings page, requires zero dynamic secret indexing, and is — as ADR 0002
already flagged — the pattern recommended for the eventual organization scenario anyway, so
choosing it now means no future migration of the secrets contract. `docs/adr/0002-secrets-strategy.md`
and `clarify-log.md` Q2 updated accordingly. `environmentFiles`' `secret` field in the config
schema is now documentation-only (a human label matching whatever the caller named the real
secret), not something the platform looks up dynamically; `contracts/config.schema.json` gets
`"maxItems": 6` on `environmentFiles`.

## Finding 2 (CRITICAL): active consumers beyond Pricely were not accounted for

**Where found**: `plan.md`'s Project Structure implicitly retired `docker-deploy-ssh.yml` and
renamed `github-release.yml` to `release.yml` without an explicit backward-compatibility
decision, and `tasks.md` T022 planned to change `docker-build.yml`'s version-extraction default
in a way that would change tagging behavior for existing callers.

**Verification performed**: `gh search code "Gabrimeireles/reusable-workflows" --owner
Gabrimeireles` (not assumed from the brief, which only named Pricely) found three more real,
currently-pinned consumers: `Gabrimeireles/CoGuide_PPS_BackEnd` and
`Gabrimeireles/CoGuide_PPS_FrontEnd` (pinned to `v1.5`/`v1.7`) and `Gabrimeireles/Conecta_SLA`
(pinned to `v1.5`/`v1.8`), all three using `docker-build.yml`, `docker-deploy-ssh.yml`,
`github-release.yml`, and/or `swagger-pages.yml`. Tags `v1` through `v1.8` exist and are real,
load-bearing release points (`git ls-remote --tags`, `gh api .../tags`) — not just a documented
example.

**Impact**: The original plan would have broken three repositories outside this feature's
stated scope, violating Principle IV, the very first time any of them re-ran a workflow after
`v1` (floating) moved (or immediately, for anything pinned to `v1.5`/`v1.7`/`v1.8` if those tags
were ever force-moved instead of left alone).

**Resolution** (scope decision, not silently applied — see final report to the user):
- `docker-deploy-ssh.yml`, `github-release.yml`, and `swagger-pages.yml` are **left behaviorally
  unchanged** — only additive hardening allowed (explicit `permissions:` if missing, pinning
  third-party actions by SHA) that cannot change their inputs/outputs/secrets contract or
  runtime behavior. They are not renamed, not removed, not merged into the new files.
- `deploy-stack.yml`, `release.yml`, `validate-caller.yml`, and `ci.yml` are **net-new,
  additive** workflows, not replacements. `release.yml` is a distinct, more general workflow
  that coexists with `github-release.yml` (which is kept for the existing three consumers);
  it is not "github-release.yml renamed."
- `docker-build.yml`'s fix for FR-002 must be backward-compatible: `version_file` is added as a
  new optional input **defaulting to `./package.json`** (the exact current hardcoded path, so
  behavior for every existing caller with a root `package.json` — CoGuide, Conecta_SLA, and
  Pricely's own root `package.json` — is byte-for-byte unchanged), and version extraction is
  **skipped (not an error) when the resolved path doesn't exist**, so a caller can either point
  it at `backend/package.json`/`web/package.json` or pass `""` to disable version tagging
  entirely. This is a strictly additive, non-breaking change and ships as a `v1` minor release.
- Migrating `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, and `Conecta_SLA` to the new
  `deploy-stack.yml`/`validate-caller.yml` platform is explicitly **out of scope** for this
  feature (the brief scoped migration to Pricely only) and is called out as follow-up work in
  the final report, now that `docs/adding-a-project.md` documents the same path Pricely uses.

## Finding 3 (minor): "single trusted caller" wording

**Where found**: `docs/adr/0002-secrets-strategy.md` framed the personal-account trust argument
around a single caller repository.

**Resolution**: Reworded to "single trusted maintainer across multiple caller repositories" —
the argument (no untrusted collaborator can gain secret access `inherit` wouldn't already grant)
holds identically with 4 repos or 1, since it turns on who controls the account, not on the
count of repos. Since Finding 1 removed `inherit` from the recommended pattern anyway, this
wording only matters for the historical/rationale text, not the final mechanism.

## Finding 4 (minor): `spec.md` Assumptions bullet referenced `secrets: inherit` directly

**Resolution**: Updated to describe the explicit-mapping mechanism instead, keeping the
`[NEEDS CLARIFICATION: confirmed — see Clarifications]` marker pointing at the (now corrected)
Q2 entry.

## Non-findings (checked, no issue)

- Constitution Principles I–XV: no contradictions found against `spec.md`/`plan.md` after the
  above fixes.
- FR-042 ("every secret declared in `on.workflow_call.secrets`") remains fully consistent with
  the corrected Finding 1 resolution — the `ENV_FILE_1..6` slots are, in fact, statically
  declared, which is exactly what FR-042 requires.
- `data-model.md`'s other entities (Project, Image definition, Compose, Database, Health check)
  had no conflicts with `contracts/config.schema.json`.
- ADR 0001, 0003, 0004, 0005, 0006 required no changes.

## Actions taken

- [x] `clarify-log.md` Q2 rewritten with the corrected decision and the verified GitHub Actions
      constraints driving it.
- [x] `docs/adr/0002-secrets-strategy.md` rewritten (explicit mapping + `ENV_FILE_1..6`, updated
      "single trusted maintainer" wording).
- [x] `contracts/workflow-contracts.md` finalized with the concrete secrets list.
- [x] `data-model.md` "Environment files" section updated (positional slots, `secret` field is
      documentation-only, max 6 entries).
- [x] `contracts/config.schema.json` updated (`maxItems: 6` on `environmentFiles`).
- [x] `spec.md` Assumptions bullet reworded.
- [x] `tasks.md` T022 (docker-build.yml) and T030–T036 (env file plumbing) descriptions updated
      for backward compatibility and the positional secret slots.
- [x] `plan.md` Project Structure note clarified: existing workflows are kept, new ones are
      additive (see updated Structure Decision paragraph).
