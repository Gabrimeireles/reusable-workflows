# Release Manifest

Every `deploy-stack.yml` run produces `release-manifest.json` — the structured record of that
deploy, and the single source of truth the step summary is rendered from (Constitution Principle
XVII, [`docs/adr/0010-release-manifest.md`](adr/0010-release-manifest.md)).

## Where to find it

- **On the server**, at `<deploy_path>/release-manifest.json`. The previous run's manifest is
  preserved as `release-manifest.previous.json` before the new one is written (same pattern as
  `.env.previous`/`docker-compose.previous.yml`).
- **As a workflow artifact** named `release-manifest-<project>-<environment>`, retained 90 days —
  readable from the Actions UI without SSH access.

## Schema

[`​.github/schema/release-manifest.schema.json`](../.github/schema/release-manifest.schema.json).
Summary:

```json
{
  "manifestVersion": 1,
  "project": "myapp",
  "environment": "homolog",
  "environmentLabel": "homolog @ hetzner-1",
  "git": { "commit": "...", "branch": "master", "actor": "octocat" },
  "images": {
    "backend": { "ref": "ghcr.io/o/myapp-backend:sha-abc1234", "digest": "sha256:...", "sizeBytes": 123456789 }
  },
  "previousImages": "BACKEND_IMAGE=...\nIMAGE_TAG=...\n",
  "compose": { "file": "docker-compose.yml", "checksum": "sha256...", "envChecksum": "sha256..." },
  "database": { "backupFile": "backups/pre-deploy-....dump", "migrationRan": true, "resetRan": false, "seedRan": false },
  "timings": { "upload": 3, "backup": 12, "migration": 5, "deploy": 8, "healthcheck": 20 },
  "healthChecks": [{ "name": "web", "outcome": "success", "attempts": "3" }],
  "timestamp": "2026-08-02T00:00:00Z",
  "durationSeconds": 60,
  "overallStatus": "success",
  "rollbackCommand": "cd /srv/stacks/myapp && docker compose --env-file .env.previous -f docker-compose.previous.yml up -d --force-recreate"
}
```

Note what's deliberately **not** in it: no secret values, no `.env`/env-file contents — only
checksums (Constitution Principle III). You cannot reconstruct a secret from its sha256.

## Using it for rollback

`rollbackCommand` is literal and runnable as-is on the server — see
[`docs/rollback.md`](rollback.md). `previousImages` and the checksums let you confirm what was
running before this deploy without digging through logs.

## Why the summary doesn't compute its own numbers

Earlier, the deploy summary (`$GITHUB_STEP_SUMMARY`) independently recomputed everything it
showed from raw step outputs. That meant the summary and any other record of the deploy could,
in principle, disagree. Now the summary (`deployment-summary` composite action) does nothing but
format the manifest — one source of truth, formatted one way for humans (Markdown) and kept
verbatim another way for tooling/audits (JSON).
