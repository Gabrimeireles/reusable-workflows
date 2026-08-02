# Architecture Analysis — Iteration 2 (Platform Maturity)

**Status**: Analysis only — no code changed. Per explicit instruction, this document precedes
any implementation. It is the input to a future `/speckit-specify` → `plan` → `tasks` →
`implement` cycle for a new feature directory (`002-platform-maturity`), once the open questions
in §9 are resolved.

## 0. Method

Before writing anything below: re-read the full constitution, all 6 ADRs, all of
`specs/001-reusable-ci-platform/`, every file under `docs/`, every reusable workflow (`ci.yml`,
`docker-build.yml`, `deploy-stack.yml`, `release.yml`, `validate-caller.yml`, and the three
legacy workflows), every composite action, `validate-config.mjs`, and every test. Re-ran
`make validate` (actionlint, shellcheck on both standalone scripts and extracted composite-action
steps, yamllint, `node --test`, `bats`) — still fully green, and confirmed the same on GitHub CI
for PR #5. Checked for drift on both `reusable-workflows` (branch `speckit/reusable-ci-platform`)
and `Pricely` (branch `migrate/reusable-workflows-v1`, PR #484) — neither has moved since
iteration 1 landed; both PRs are still open drafts.

**Load-bearing fact for everything below**: `deploy-stack.yml`, `release.yml`,
`validate-caller.yml`, and the declarative config schema have **zero production callers today**.
No `v1` tag has been cut. Pricely's migration branch is `workflow_dispatch`-only and its new
secrets (`COMPOSE_ENV_EXTRA`, `ENV_FILE_1/2`) don't exist yet, so it cannot even run. This means
Constitution Principle IV ("no breaking changes within a major") does not yet constrain these
four artifacts — they are pre-1.0. It **does** still fully constrain: `docker-build.yml`'s
pre-existing inputs (`image_name`, `dockerfile`, `context`, `node_version`, and now
`version_file`'s default), and the three legacy workflows (`docker-deploy-ssh.yml`,
`github-release.yml`, `swagger-pages.yml`), which real, active repositories
(`CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, `Conecta_SLA`) are pinned to today. This
distinction shapes several recommendations below: where I'm proposing a contract change to the
new platform, it is **not** a breaking change in the SemVer sense, because there is no released
version to break yet. The right move is to *finish getting the contract right* and cut `v1.0.0`
once, not to ship a `v1.0.0` now and immediately need a `v1.1.0`/`v2.0.0` for what iteration 2
asks for.

## 1. What's worth keeping (don't re-architect what already works)

- The reusable-workflow/composite-action split (ADR 0001) is sound and should stay the seam
  along which new capability is added.
- The "opaque command" principle for project-specific behavior (ADR 0005) generalizes cleanly to
  hooks (§4) — it does not need to change, only to be applied more broadly.
- The secrets strategy (ADR 0002 — explicit map + positional `ENV_FILE_1..6`) is correct given
  the verified GitHub Actions constraints (mutual exclusivity of `inherit`/explicit map; no
  dynamic secret lookup) and does not need to change for this iteration.
- `deploy-compose`'s three-stage split (`snapshot` / `start` / `recreate`) and the
  snapshot-before-upload ordering are correct and are the right foundation for the release
  manifest and rollback work below.
- The dependency-free Node validator for the declarative config (ADR 0003) was the right call
  and turns out to be exactly the right *place* to implement the plugin system (§2) — this
  wasn't foreseen in iteration 1 but the pieces fit.

## 2. Critical findings

### 2.1 Duplication

- **`deploy-stack.yml` lines 369–435**: four near-identical 16-line `health-check` step blocks
  (`hc1`..`hc4`), differing only in the `steps.resolve.outputs.hc_N_*` index. Adding a 5th health
  check today requires editing the reusable workflow itself — which directly contradicts this
  iteration's goal.
- **`deploy-stack.yml` lines 265–282**: six near-identical 3-line `env_file_N_*` input groups
  passed into `prepare-deploy-files`. Same shape of problem, smaller blast radius (env files
  change less often than health checks in practice, but the smell is identical).
- **`deploy-stack.yml` lines 187–206**: the "resolve config-derived values" step manually unrolls
  `environmentFiles[0..5]` and `healthChecks[0..3]` into ~30 flat `GITHUB_OUTPUT` keys via two
  bash `for` loops emitting `jq` calls. This is where the "up to 6" / "up to 4" caps are actually
  enforced today, and it's the same underlying problem as the two points above, one layer down.
- **One reusable workflow per image** at the *caller* level: Pricely's
  `deploy-homolog-stack.yml` has a `build-backend` job and a `build-web` job, each a separate
  `uses: docker-build.yml` call, plus hand-built `image_refs` JSON string-interpolating both
  jobs' outputs. A third image means a third copy-pasted job. This is exactly the "workflow per
  image" problem named in the request, and it lives in the *caller*, which is worse than if it
  lived centrally — every consumer repeats it.

### 2.2 Coupling

- `deploy-stack.yml`'s "Resolve config-derived values" step (line 157) is a single ~50-line bash
  block that knows the *entire* shape of the declarative config (compose fields, database
  fields, environment-file fields, health-check fields). This couples the orchestrating workflow
  to the config schema's internal structure — a schema change (e.g. adding a field a composite
  action needs) requires editing this step, not just the schema and the consuming action. It
  should not be the workflow's job to know this much about the config's shape.
- Composite actions each receive many individually-named scalar inputs
  (`backup-postgres`: 9 inputs; `health-check`: 11 inputs) derived from the config by the
  workflow rather than receiving a config slice directly and extracting what they need
  themselves. This means every composite action's *input contract* also encodes config-schema
  knowledge, duplicating that knowledge across the workflow and N actions.
- `run-database-command` is named and scoped around "database" but its actual mechanism — run an
  opaque command inside a named Compose service, remote, via the safe stdin-heredoc pattern — is
  exactly the mechanism hooks (§4) need for non-database lifecycle points too
  (`pre_deploy`/`post_cleanup`/etc). Its name is now a coupling to a use case narrower than what
  it will need to serve.

### 2.3 Reusability blockers (the ones that matter most for "dozens of projects, 5 years")

- **No way to add a new image without editing the caller's job graph.** This is the highest-
  priority blocker — it's explicitly called out in the request and is the one thing that makes
  "just edit the YAML" not yet true for the most common growth path (a project adding a service).
- **No plugin mechanism** — every piece of per-stack-type knowledge (a Postgres backup
  assumption, a Prisma migration convention, a Next.js health check shape) either has to be
  fully spelled out in every project's config, or would have to be hardcoded centrally
  (forbidden by Principle VIII). There is currently no third option, which means genuinely
  reusable defaults ("if you say `postgres`, you get a sane backup/health-check default") don't
  exist — every project re-specifies everything, every time.
- **`workflow_call.inputs`/`uses:` cannot be dynamic in GitHub Actions.** This is a hard platform
  constraint that determines *where* the plugin system can live (see §3) — it is not possible to
  do `uses: ./.github/plugins/${{ matrix.plugin }}/action.yml`. Any plugin design that assumes
  dynamic `uses:` resolution will not work and would be discovered broken only at implementation
  time; flagging it now avoids that.
- **No release manifest, so no structured rollback data** — today's rollback story
  (`docs/rollback.md`) is prose plus two snapshot files (`*.previous`). It works, but a human has
  to reconstruct the rollback command from documentation instead of reading it off a generated
  artifact.
- **`v1` floating-tag update is documented as a manual step in ADR 0004, and doesn't exist as a
  workflow at all yet.** The request now asks for this to be automatic — a deliberate amendment
  to ADR 0004, not an oversight to quietly fix.
- **Observability gaps**: `docker-build.yml` already computes a `digest` output — it is never
  surfaced in the deploy summary. There is no per-phase timing (only one start-to-finish timer).
  Health checks report success/failure but not attempts-used or response time.

## 3. Design direction per requested capability

### 3.1 Build matrix (request §1)

**Constraint discovered**: a job that calls a reusable workflow (`uses:`) *can* carry a
`strategy.matrix` — GitHub Actions supports one reusable-workflow call per matrix entry. That
solves "no more one job per image." The unsolved half is **fan-in**: outputs from a matrix job
are not aggregated across instances by GitHub Actions (only one, non-deterministic instance's
output survives at `needs.<job>.outputs.*`). `deploy-stack.yml` needs every image's
name+tag+digest, not just one.

**Recommended shape**: a new top-level orchestrating workflow (working name: `ci-cd.yml`) that:
1. `load` job — checkout, run `load-config`, expose the config's `images` array as a job output
   (already valid JSON, no new parsing needed).
2. `build` job — `strategy: matrix: image: ${{ fromJSON(needs.load.outputs.images) }}`, `uses:
   ./.github/workflows/docker-build.yml`. Each matrix instance additionally uploads a tiny
   artifact (`image-<id>.json`: `{id, image, tag, digest, size}`) — the standard, well-
   established fan-in idiom for exactly this GitHub Actions limitation.
3. `collect` job — downloads all `image-*.json` artifacts, merges them with `jq` into the single
   `image_refs` JSON `deploy-stack.yml` already expects. No change needed to `deploy-stack.yml`'s
   input contract.
4. `deploy` job — `uses: ./.github/workflows/deploy-stack.yml` with the collected `image_refs`.

This keeps `docker-build.yml` and `deploy-stack.yml` as independently usable building blocks
(Pricely's current draft, which builds explicitly and calls deploy separately, keeps working
unchanged) while adding `ci-cd.yml` as the one-call entry point for new projects. Adding a fourth
image becomes purely a `.github/deploy/<env>.yml` edit — no job graph change, anywhere.

### 3.2 Plugin architecture (request §2)

**Constraint discovered**: since `uses:` cannot be dynamic, a plugin cannot be "a composite
action selected at runtime by name." Any design where the *workflow* dynamically loads a plugin
is not implementable on this platform.

**Recommended shape**: plugins live one layer down, inside the **Node config loader** we already
control end-to-end (`validate-config.mjs`, run by `load-config`). A plugin is a small directory
under `.github/plugins/<name>/plugin.mjs` (shipped in `reusable-workflows`, available to every
caller via the same checkout mechanism composite actions already use) exporting a plain object:

```js
export default {
  name: "prisma",
  defaults: { database: { migration: { command: "npx prisma migrate deploy" } } },
  validate(config) { /* return extra issues, e.g. "prisma requires database.enabled" */ },
  hooks: { pre_migration: "npx prisma generate" },
  healthChecks: [],  // optional default health check template(s)
};
```

The caller declares `plugins: [prisma, postgres]` in its YAML config. `load-config`'s Node script
`import()`s each declared plugin (a plain dynamic `import()` — normal Node.js, nothing to do with
GitHub Actions' `uses:` resolution), deep-merges `defaults` under the caller's own config
(caller-specified values always win — a plugin only fills gaps), runs each plugin's `validate`,
and folds `hooks`/`healthChecks` in before producing the final JSON blob `deploy-stack.yml`
already consumes. **No reusable workflow or composite action needs to change when a plugin is
added or a new one is written** — this is the property that makes it survive "5 years, dozens of
projects." A new plugin is a new folder plus a fixture test, full stop.

This doubles as the mechanism for semantic-validation and hook defaults (§3.3, §3.4) — they're
the same merge/validate pass, not three separate systems.

### 3.3 Hooks (request §3)

Same execution primitive as today's migration/reset/seed (an opaque command run remotely via the
safe stdin-heredoc pattern) — generalized and given a name at each of the twelve lifecycle
points requested. Two things need to be precise:

- **Execution context differs by hook**: `pre_build`/`post_build` run on the GitHub-hosted
  runner (build hasn't touched the remote host yet); every other hook
  (`pre_backup`/`post_backup`/`pre_migration`/`post_migration`/`pre_deploy`/`post_deploy`/
  `pre_healthcheck`/`post_healthcheck`/`pre_cleanup`/`post_cleanup`) runs remotely, same as
  `run-database-command` today. The design needs two thin executor paths (runner-local vs.
  remote-via-SSH), not twelve.
- **"comando, script, ou plugin"** all resolve to the same final string before execution: a
  literal command stays as-is; a script path becomes `bash <path>`; a plugin-sourced hook is
  substituted by `load-config`'s merge step before the workflow ever sees it. The executor
  composite action only ever sees "a command to run" — it does not need to know which of the
  three it came from. This is the same "keep the executor generic, resolve specifics upstream"
  pattern already proven by ADR 0005.
- Recommend renaming `run-database-command` → `run-remote-command` (with `label`/`service`/
  `command` inputs unchanged) since it is now the executor for every remote hook, not just
  database ones. Cheap to do now (no released consumers), expensive to do later.

### 3.4 Release manifest (request §4)

A JSON document, generated once per deploy from data every composite action already produces
(image refs/digests, backup file path, health outcomes, timing), written to two places:
1. **The server**, alongside `docker-compose.previous.yml`/`.env.previous`, as
   `release-manifest.json` — with the *previous* manifest snapped to
   `release-manifest.previous.json` in the same `snapshot` stage that already exists in
   `deploy-compose`, before the new one is written. This is additive to a stage that already
   does exactly this kind of snapshot-then-overwrite for two other files.
2. **A workflow artifact** (`actions/upload-artifact`), so the manifest is inspectable from the
   Actions UI without SSH access to the server.

Recommend `deployment-summary` stops independently re-deriving the human summary from raw step
outputs and instead: (a) a new step assembles the manifest JSON first (single source of truth),
(b) `deployment-summary` renders the Markdown summary *from* the manifest. This removes the
duplication where "what the summary shows" and "what gets recorded" are two independently
maintained things that can drift.

A manifest schema (`.github/schema/release-manifest.schema.json`) should exist for the same
reason the deploy-config schema exists: documentation + a validation target for tests.

### 3.5 Rollback preparation (request §5)

No behavior change beyond what §3.4 already adds: the manifest's presence means
`docs/rollback.md`'s procedure can be *generated/verified against* a real manifest field
(`rollbackCommand`: the exact `docker compose --env-file .env.previous -f
docker-compose.previous.yml up -d --force-recreate` string, computed once and stored) rather than
hand-maintained prose a human has to trust matches reality. Still no automatic rollback — ADR
0006's reasoning is untouched by this iteration.

### 3.6 Semantic validation (request §6)

Extends `validate-config.mjs` (still zero-dependency Node) with checks that need the *already-
checked-out caller repository* on disk (available because `deploy-stack.yml`/`validate-caller.yml`
checkout before calling `load-config`):

- `compose.source` file exists; every `images[].dockerfile` and `images[].context` exist.
- Every service name referenced anywhere (`compose.dependencyServices`,
  `compose.applicationServices`, `database.migration.service`, `healthChecks[].service`) is
  actually declared under `services:` in the resolved Compose file (parsed with `yq`, already a
  required tool).
- Duplicate `environmentFiles[].destination` values (two secrets silently overwriting the same
  file).
- Declared `plugins: [...]` entries correspond to a real plugin directory; declared hook names
  are from the fixed, documented set of twelve.
- **Open question, not decided here**: "duplicate ports" from the request implies the config
  models ports somewhere, but it currently doesn't (ports live in the Compose file / the
  `COMPOSE_ENV_EXTRA` secret, both outside the platform's declarative model). Modeling ports in
  the schema purely to validate them would be new scope, not a fix to existing scope — see §9.

Every check should keep the current validator's behavior of collecting *all* issues before
failing (already true today), so a caller fixes everything in one pass instead of one-error-at-
a-time.

### 3.7 Observability (request §7)

- Surface `digest` (already computed by `docker-build.yml`, currently dropped) and image size
  (`docker/build-push-action` exposes this) in the manifest and summary.
- Per-phase timing: wrap each major stage (`build`, `upload`, `backup`, `migration`, `deploy`,
  `healthcheck`) with a start/stop pair feeding the manifest, replacing the single overall timer.
- `health-check` composite action gains an `attempts_used` output alongside `outcome`.
- **Constraint to respect while doing this**: `DEPLOY_HOST` is a secret. "Infra: host" in a
  Markdown summary must not print the secret value — either omit it, or let the config declare a
  non-secret display label (e.g. `project.environmentLabel: "homolog @ hetzner-1"`) distinct from
  the actual connection secret. Maximizing observability must not regress Principle III.

### 3.8 Release versioning automation (request §8)

This is a deliberate **amendment to ADR 0004**, not a bug fix: today's ADR explicitly says the
`v1` float move is a separate, maintainer-triggered step; the request asks for it to happen
automatically when a `1.x.y` ships. Recommendation: `release.yml` gains a step that, after
tagging `vX.Y.Z`, force-moves `refs/tags/vX` to the same commit **unless** the release is a
prerelease, with a boolean input (default `true`) to opt out per-run. This is a force-push-like
operation (rewrites what a tag points to) — worth the explicit opt-out rather than making it
fully unconditional. Document the amendment in the ADR itself (superseding text, not a silent
edit) and in `CHANGELOG.md`.

### 3.9 Consumer experience (request §9)

With §3.1 (matrix orchestrator) and §3.2 (plugins) in place, the target caller shrinks to
exactly the two files the request asks for: `.github/workflows/deploy.yml` (trigger +
permissions + one `uses: ci-cd.yml` call + the `secrets:` map) and `.github/deploy/<env>.yml`
(everything project-specific, now including `plugins:` and `hooks:`). No per-image jobs, no
hand-built `image_refs` JSON, no per-project knowledge of Tailscale/SSH/GHCR/backup mechanics —
all already true today for the deploy side, and extended to the build side by §3.1.

### 3.10 Architecture review / simplification (request §10)

Concrete simplifications, in order of impact:
1. Move config-shape knowledge out of `deploy-stack.yml`'s inline "resolve" step and into the
   composite actions that actually need each field — each action takes a JSON slice input (e.g.
   `database_json`, `health_checks_json`) and extracts what it needs internally with `jq`,
   instead of the workflow pre-flattening ~30 named outputs. This directly removes the coupling
   in §2.2.
2. Collapse the 6 `env_file_N_*` input groups into one JSON-array input to
   `prepare-deploy-files`, built in a single step from the 6 secrets (still statically declared,
   per ADR 0002 — only the *plumbing* into the composite action collapses, not the secret
   contract).
3. For health checks, recommend **keeping the inline per-slot steps** rather than introducing a
   matrix job: health checks are cheap, typically 1-2 per project, and a matrix job would need
   the same artifact fan-in complexity as builds for no real benefit at this scale — this is a
   case where the simpler, already-working approach should stay (see §9 for the one open
   question here: whether to raise the cap or keep it at 4).
4. Rename `run-database-command` → `run-remote-command` (§3.3).
5. `resolve-project` and `load-config` need no structural change — they're already the right
   shape.

### 3.11–3.14 (tests, backward compatibility, docs, quality)

Covered operationally, not architecturally — these are execution tasks once the design above is
confirmed, not open design questions. They'll be enumerated in `tasks.md` once `/speckit-plan`
runs for this feature. Backward compatibility posture is the one from §0: freeze nothing that
hasn't shipped; freeze everything that has (the three legacy workflows, `docker-build.yml`'s
pre-existing inputs).

## 4. Constitution impact

None of the above breaks a constitution principle; two additions are worth ratifying explicitly
when this becomes a real spec: a principle codifying "no dynamic `uses:` — plugin/extensibility
logic lives in the Node config loader, not in workflow YAML" (this is now a load-bearing
architectural rule, not just an implementation detail), and a principle requiring every deploy to
produce a release manifest (elevating §3.4 from a feature to a guarantee, the same way Principle
XI already guarantees a step summary).

## 5. Recommended sequencing

1. Ratify constitution v1.1.0 (the two additions in §4) — minor version bump, additive.
2. `/speckit-specify` for `002-platform-maturity`, incorporating §3 as the starting design.
3. `/speckit-clarify` on the one open question in §9.
4. `/speckit-plan` + `/speckit-tasks`, then `/speckit-analyze` before implementing — same
   discipline as iteration 1, which is exactly what surfaced the secrets/inherit conflict and the
   three undiscovered consumers last time.
5. Implement, re-run `make validate`, update Pricely's draft caller to the new `ci-cd.yml` entry
   point (still on its own branch, still not cut over), tag `v1.0.0` only once all of this is in.

## 6. Open questions (need your call before `/speckit-plan`)

1. **Ports in the schema**: model ports so "duplicate ports" can be validated (new scope), or
   leave ports as a Compose/`.env` concern outside the platform's declarative model (current
   scope, "duplicate ports" check dropped)?
2. **Health-check cap**: keep the inline 4-slot approach (my recommendation, §3.10.3) or raise
   the cap / move to a matrix+artifact design now for headroom?
3. **`v1` auto-move default**: automatic-with-opt-out (my recommendation, §3.8) or keep it a
   fully separate manual action as ADR 0004 currently says, just document it better?

Everything else in §3 is a recommendation I'm confident in and will proceed with unless you
redirect.
