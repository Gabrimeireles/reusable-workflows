# ADR 0004: Semantic Tags + Floating Major, SHA for Bleeding-Edge Only

**Status**: Accepted — 2026-08-01

## Context

The current Pricely workflow pins to a raw commit SHA
(`dd91057fc0ac8afcebbc7ae6ee1d1bdb65792e5a`) with no record of *why* that SHA, no changelog, and
no defined process for ever moving off it. The constitution (Principle IV) requires backward
compatibility within a major version, which only means something if "major version" is an actual
published, moving reference.

## Decision

- Every merge to the default branch that changes behavior gets a semantic tag: `vMAJOR.MINOR.PATCH`
  (e.g. `v1.3.0`), created via this repository's own `release.yml` (dogfooding the platform).
- A floating `v1` tag (and `v2`, etc., once it exists) is force-updated to point at the latest
  compatible release on that major line whenever a new `v1.x.y` ships. Mechanically: after
  tagging `v1.x.y`, a repository-maintainer-triggered step (`workflow_dispatch`, not automatic on
  every push) re-points `refs/tags/v1` to the same commit.
- **Caller pinning policy**:
  - Production-critical callers (Pricely's homolog/production deploys) SHOULD pin to a specific
    `vMAJOR.MINOR.PATCH` tag, not `v1` and not a raw SHA, so an upgrade is a deliberate,
    reviewable one-line PR bump rather than a silent floating-tag change or an unexplained SHA.
  - `v1` (floating) is acceptable for low-stakes/experimental callers that explicitly want to
    always run the latest compatible release.
  - A raw commit SHA is acceptable only temporarily (e.g. testing an unreleased fix) and MUST be
    accompanied by a comment/issue link explaining why, per Principle IV/XII — exactly the gap
    Pricely's current pin has today, which `docs/migration-pricely.md` corrects.
- `CHANGELOG.md` (Keep a Changelog format) is updated in the same PR as any user-visible change;
  `release.yml`'s auto-generated release notes supplement, not replace, the curated changelog.
- Breaking changes bump MAJOR, are called out at the top of `CHANGELOG.md` under a `## Breaking`
  heading, and get a migration note in `docs/adding-a-project.md`/`docs/migration-pricely.md` as
  applicable, per Principle IV.

## Consequences

- `v1` updates require one explicit maintainer action, not "whatever happens to be on the
  default branch when a run kicks off" — avoids a caller's next run silently picking up an
  in-progress, possibly broken change.
- Pricely's post-migration workflow pins to a concrete `v1.0.0`-style tag with a documented
  upgrade procedure (`docs/architecture.md` "Updating v1"), closing the "permanently on a
  temporary SHA" gap called out in the brief.
