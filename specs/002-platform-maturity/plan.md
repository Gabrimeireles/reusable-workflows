# Implementation Plan: Platform Maturity (Iteration 2)

**Branch**: `speckit/reusable-ci-platform` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)

**Input**: `spec.md`, `clarify-log.md`, `architecture-analysis.md`, ADRs 0007–0010, amended ADR
0004.

## Summary

Add a build-matrix entry-point workflow, a Node-resolved plugin system, twelve lifecycle hooks, a
release manifest that becomes the single source of truth for the deploy summary, expanded
semantic validation, richer observability, and automated `v1` tag management — all additive to
the iteration-1 platform, which has no tagged release yet and therefore no deprecation cycle to
manage for its own contracts (spec.md FR-091). Legacy workflows and `docker-build.yml`'s existing
inputs are untouched.

## Technical Context

Unchanged from `specs/001-reusable-ci-platform/plan.md` (GitHub Actions YAML, Bash, a small
amount of Node.js, `yq`/`jq`, `bats-core`), with one addition: the config loader's Node script
grows a plugin-resolution layer using dynamic `import()` — still zero runtime npm dependencies
(ADR 0007 reaffirms the "no ajv/ecosystem dependency" stance from ADR 0003).

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. Minimal, declarative callers | `ci-cd.yml` reduces the caller further (no per-image jobs) | PASS |
| II. Security by default | Hooks/plugins resolve to plain commands, executed via the existing safe SSH pattern; no new interpolation surface | PASS |
| III. No secret exposure | Manifest stores checksums, never contents; infra labels are caller-supplied non-secret fields (spec FR-063) | PASS (verified per-action in Phase 1) |
| IV. Backward compatibility within major | N/A to new platform contracts pre-1.0 (FR-091); legacy workflows + docker-build.yml existing inputs frozen | PASS |
| V/VI. Immutable tags / idempotent deploy | Matrix build still produces one SHA tag per image; `image_refs` shape unchanged from iteration 1 | PASS |
| VII. Destructive ops explicit | Unchanged (reset guard untouched) | PASS |
| VIII. Central workflows generic | Plugins are the mechanism that keeps them generic even as stack-specific defaults grow | PASS |
| IX. Project config stays local | Hooks/plugins are declared per-project; defaults only fill what the project leaves unset | PASS |
| X. Tests without prod dependency | New fixtures/bats specs for plugins/hooks/manifest run against local mocks only | PASS |
| XI. Mandatory observability | Manifest is now the source; summary renders from it | PASS |
| XII. Docs part of delivery | docs/plugins.md, hooks.md, release-manifest.md, updated architecture/caller-contract/rollback | PASS (tracked in tasks.md) |
| XIII. Pin external actions | New `actions/upload-artifact`/`download-artifact` steps use `actions/*` namespace (exempt) | PASS |
| XIV. Least privilege | `ci-cd.yml` declares its own minimal `permissions:` | PASS |
| XV. No project as global rule | Initial plugin set is generic (framework/ORM/db names), not Pricely-specific | PASS |
| XVI. Extensibility in data, not dynamic uses: | Core design of this entire iteration (ADR 0007) | PASS |
| XVII. Every deploy produces a manifest | ADR 0010 | PASS |

No violations requiring Complexity Tracking.

## Project Structure

### New/changed files

```text
.github/
├── workflows/
│   ├── ci-cd.yml                      # NEW — matrix build + fan-in + deploy entry point (ADR 0008)
│   ├── docker-build.yml               # unchanged contract; gains optional pre_build/post_build hook steps only when called from ci-cd.yml's build job (hooks live in ci-cd.yml, not here, to keep docker-build.yml callable standalone)
│   ├── deploy-stack.yml               # gains hook steps (ADR 0009), config-slice inputs to actions (analysis §3.10.1), manifest step (ADR 0010)
│   ├── release.yml                    # gains automatic v1 move (amended ADR 0004)
│   └── validate-caller.yml            # gains the same expanded semantic validation for free (shared load-config)
├── actions/
│   ├── run-remote-command/            # RENAMED from run-database-command (ADR 0009)
│   ├── release-manifest/              # NEW (ADR 0010)
│   └── deployment-summary/            # CHANGED — renders from the manifest instead of raw inputs
├── plugins/                            # NEW (ADR 0007)
│   ├── postgres/plugin.mjs
│   ├── mysql/plugin.mjs
│   ├── redis/plugin.mjs
│   ├── prisma/plugin.mjs
│   ├── nestjs/plugin.mjs
│   ├── nextjs/plugin.mjs
│   └── vite/plugin.mjs
├── schema/
│   ├── deploy-config.schema.json      # gains plugins/hooks fields
│   └── release-manifest.schema.json   # NEW
└── scripts/
    ├── validate-config.mjs            # gains plugin resolution + expanded semantic checks
    └── lib/plugin-loader.mjs          # NEW — shared merge/resolve logic, unit-tested standalone

tests/
├── fixtures/
│   ├── config/valid/with-plugins.yml, with-hooks.yml, multi-image-matrix.yml
│   └── config/invalid/unknown-plugin.yml, unknown-hook.yml, missing-dockerfile.yml,
│         missing-context.yml, missing-compose.yml, service-not-in-compose.yml,
│         duplicate-env-destination.yml
│   └── plugins/fixture-plugin/plugin.mjs   # a minimal test-only plugin
├── unit/plugin-loader.test.mjs, validate-config.test.mjs (extended)
└── bats/hooks.bats, run-remote-command.bats (renamed), release-manifest.bats

docs/
├── plugins.md, hooks.md, release-manifest.md   # NEW
├── architecture.md, caller-contract.md, rollback.md, adding-a-project.md, README.md   # updated
└── adr/0007..0010 (new), 0004 (amended)
```

**Structure Decision**: Plugins and the manifest are additive subsystems bolted onto the existing
composite-action seam (ADR 0001) — no restructuring of what iteration 1 already got right.

## Phase 0/1 notes

Research questions were resolved directly in `architecture-analysis.md` (dynamic `uses:`
limitation, matrix output fan-in limitation) rather than repeated here. Data model additions
(Plugin, Hook, Manifest) are specified in `spec.md` Key Entities; the concrete JSON Schemas are
Phase 1 deliverables tracked in `tasks.md`, not duplicated in this plan.

## Complexity Tracking

No Constitution Check violations required justification.
