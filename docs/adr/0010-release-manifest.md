# ADR 0010: Release Manifest Is the Source of Truth; the Summary Is a View

**Status**: Accepted — 2026-08-02

## Context

Iteration 1's `deployment-summary` composite action independently re-derives everything it shows
from raw step outputs passed in as inputs. There is no persisted, structured record of a deploy —
`docs/rollback.md` is prose a human has to trust matches reality, and nothing on the server
records what was actually deployed beyond the two `*.previous` file snapshots.

## Decision

Introduce a `release-manifest` composite action that runs once, near the end of
`deploy-stack.yml`, and:

1. Assembles one JSON document (schema: `.github/schema/release-manifest.schema.json`) from data
   every earlier step/action already computed: git commit/branch/actor (`github` context),
   per-image name/tag/digest/size (from the collected matrix result — ADR 0008), the Compose
   file used and its checksum, a checksum of the rendered `.env`, whether/where a backup was
   taken, per-phase timings, health-check outcomes and attempt counts, and a literal
   `rollbackCommand` string.
2. Writes it to the server at `release-manifest.json`, with `deploy-compose`'s existing
   `snapshot` stage extended to rename the previous run's manifest to
   `release-manifest.previous.json` first (the same pattern already used for `.env`/Compose).
3. Uploads it as a workflow artifact (`actions/upload-artifact`) so it's readable from the
   Actions UI without SSH access.

`deployment-summary` is changed to **render its Markdown from this manifest** rather than from
independently-passed step outputs — one data source, one place that can be wrong instead of two
places that can silently disagree.

## Consequences

- Directly implements Constitution Principle XVII.
- `docs/rollback.md`'s procedure can reference the manifest's `rollbackCommand` field instead of
  asking a human to reconstruct it, without changing ADR 0006's manual-only rollback decision.
- Adds one composite action and one schema file; no new secrets, no new remote mechanism — pure
  aggregation of data that already exists by the time it runs.
- Checksumming `.env` client-side (on the runner, before upload) is safe: the file only exists
  transiently in the `prepare-deploy-files` temp directory and the checksum itself is not a
  secret (a hash does not allow reconstructing the input at any practical secret length used
  here), but the manifest generator still MUST NOT include the `.env`/env-file *contents*,
  only their checksums — this is called out explicitly since "observability" and "no secret
  exposure" (Principle III) are otherwise in tension.
