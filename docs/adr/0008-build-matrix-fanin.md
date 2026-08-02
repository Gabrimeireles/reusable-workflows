# ADR 0008: Build Matrix With Artifact-Based Fan-In

**Status**: Accepted — 2026-08-02

## Context

Iteration 1 requires one `uses: docker-build.yml` job per image in the caller's own workflow.
Growing from 2 to 3 images means editing the caller's job graph — exactly what this iteration
sets out to remove (spec.md User Story 1).

GitHub Actions does support a `strategy.matrix` on a job whose `uses:` calls a reusable
workflow — one call per matrix entry, generated automatically from an array. That solves "one
job, N images." It does **not** solve collecting each instance's outputs: `needs.<job>.outputs.*`
for a matrix job resolves to a single, non-deterministic instance's value, not an array of all of
them — a well-documented GitHub Actions limitation, not a bug to work around cleverly.

## Decision

A new orchestrating reusable workflow (`ci-cd.yml`) with four jobs:

1. `load` — checkout, run `load-config`, expose the resolved `images` array (already valid JSON)
   as a job output.
2. `build` — `strategy: matrix: image: ${{ fromJSON(needs.load.outputs.images) }}`, `uses:
   ./.github/workflows/docker-build.yml`. Each matrix instance additionally uploads a small
   artifact (`image-<id>.json`: `{id, image, tag, digest, size}`) via `actions/upload-artifact`.
3. `collect` — `actions/download-artifact` (merge-multiple pattern) pulls every `image-*.json`,
   and a small `jq` step merges them into the one `image_refs` JSON object `deploy-stack.yml`
   already accepts.
4. `deploy` — `uses: ./.github/workflows/deploy-stack.yml` with the collected `image_refs`.

This is the standard, well-established idiom for matrix-job fan-in in GitHub Actions (artifact
upload per instance, download-and-merge afterward) — not a novel workaround, and not something
that needs re-deriving if the platform is revisited in five years.

## Consequences

- `docker-build.yml` and `deploy-stack.yml` keep their existing, independently-callable
  contracts unchanged — `ci-cd.yml` is additive, and any project not ready to adopt it (e.g.
  Pricely's current draft, which still calls both explicitly) keeps working.
- Adding an image is purely a `.github/deploy/<env>.yml` edit (FR-002); the matrix job count
  changes automatically at run time.
- One failed image build fails its own matrix instance without necessarily stopping sibling
  builds (GitHub Actions' default `fail-fast: true` would cancel the others; this pipeline sets
  `fail-fast: false` so a failure in one image doesn't hide a real failure in another during
  development, while the `collect`/`deploy` jobs still only run if `build` fully succeeds).
- Small cost: an artifact upload/download round-trip per deploy, negligible next to SSH/backup
  time.
