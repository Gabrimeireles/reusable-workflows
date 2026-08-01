# Phase 0 Research: Reusable CI/CD Platform

## R1: How do secrets actually propagate into a reusable workflow?

**Question**: Can a secret stored in `Gabrimeireles/reusable-workflows` be read by a workflow
called from `Gabrimeireles/Pricely`?

**Finding (verified against current GitHub Actions documentation, not assumed)**: No. A called
reusable workflow only receives secrets its caller's job explicitly forwards — either via a
named `secrets:` map on the `uses:` block, or via `secrets: inherit`, which forwards the
*caller's own* repository/organization/environment secrets. Secrets defined in the repository
that merely *hosts* the reusable workflow file are irrelevant to this — that repository's own
Actions runs (if it had any) would use them, but a caller's job never reaches into the called
repository's secret store. Nesting also does not auto-cascade: if workflow A calls B with
`secrets: inherit` and B calls C, B must still explicitly forward to C.

**Implication**: Every consumer repository (Pricely today) must hold its own copy of every
infrastructure and application secret it needs. This repository (`reusable-workflows`) must
never be designed as if it could centrally hold a secret once for everyone. Full detail and the
personal-account vs. organization strategy: `docs/secrets-and-environments.md`.

## R2: Reusable workflow nesting / structural limits

**Finding**: GitHub allows up to 10 total levels of workflow (1 top-level caller + up to 9
nested reusable workflow calls). Composite actions (`.github/actions/*`) are a different
mechanism — they cannot themselves call a reusable workflow, only other actions/steps — so they
don't count against this limit. Our design nests one level (`deploy-stack.yml` calling composite
actions), well inside the limit. No documented hard limit was found for input/secret/output
*counts*, so no numeric budget is imposed by the platform itself beyond what's practical to read
in a PR diff.

## R3: `workflow_call.inputs` cannot express lists or objects

**Finding**: `on.workflow_call.inputs.<name>.type` only accepts `string`, `boolean`, `number`,
or `choice`(via UI-only `workflow_dispatch`); there is no `array`/`object` input type. Any
attempt to model "one or more images" or "zero or more health checks" as pure inputs requires
either a fixed number of numbered scalar inputs or a JSON-encoded string passed as one input.

**Implication**: Confirms `docs/adr/0003-config-model.md` — the hybrid model (scalar inputs for
always-present values, a declarative YAML file for list/nested data) is the only approach that
stays readable at both call sites.

## R4: `environment:` inside a called reusable workflow

**Finding**: When a job inside a *called* reusable workflow declares `environment: <name>`, that
environment is resolved against the repository that is running the workflow for that specific
call context — practically, this means a caller repository can define an Environment (e.g.
`pricely-production-reset`) with required reviewers, and a reusable workflow's job that declares
`environment: ${{ inputs.reset_environment }}` will be gated by *that caller's* environment
protection rules, without this repository needing any environment of its own. This is the
mechanism `docs/adr/0006-rollback-strategy.md` and Principle VII rely on for optional
reviewer-gated destructive operations — it is opt-in per caller (a caller that never configures
the environment simply never gets the extra approval gate).

## R5: Toolchain choices

- **actionlint**: distributed as a single static Go binary (or `rhysd/actionlint` container
  image) — no runtime dependency beyond downloading/caching the binary; chosen over writing a
  custom workflow linter.
- **shellcheck**: available as a Debian/Ubuntu package (`apt-get install shellcheck`) and
  pre-installed on GitHub-hosted `ubuntu-latest` runners; used both in this repo's own CI and in
  `scripts/bootstrap.sh` for local dev.
- **yamllint**: Python package (`pip install yamllint` or `pipx`), also commonly pre-available;
  used for style/consistency, not semantic workflow validation (that's actionlint's job).
- **Declarative config validation**: rejected `ajv-cli` (npm) and `jsonschema` (pip) as *runtime*
  dependencies to avoid a network-dependent `npm install`/`pip install` step in every deploy run;
  chose a small hand-written Node script (`~/.github/scripts/validate-config.mjs`) using only
  Node's standard library plus `js-yaml`-free parsing via `yq -o=json` beforehand (so the Node
  script only ever deals with already-parsed JSON). `contracts/config.schema.json` remains the
  documented, versioned source of truth the hand-written validator is tested against
  (`tests/unit/validate-config.test.mjs` asserts every fixture's validator verdict matches what
  the schema alone would say for the fields it covers).
- **bats-core**: chosen for composite-action shell testing over raw `bash -x` scripts because it
  gives readable pass/fail output and is easy to run identically in CI and locally.
- **act**: evaluated for full local workflow execution; not adopted as a required tool because
  it cannot faithfully emulate `tailscale/github-action` or real SSH-based deploy targets — our
  test strategy instead unit-tests the composite actions' shell logic directly (Principle X)
  rather than trying to run entire workflows locally. `act` remains a documented optional
  convenience in `scripts/bootstrap.sh` for anyone who wants to smoke-test `docker-build.yml`'s
  build steps locally.

## R6: Real Pricely commands (verified, not assumed)

From `Pricely/backend/package.json` and `Pricely/backend/prisma/*.js`:
- Migration: `npm run db:generate && npm run db:migrate:deploy:safe` (the "safe" variant runs a
  custom `prisma/migrate-deploy.js` guard, not plain `prisma migrate deploy`).
- Reset: `npm run db:generate && npm run db:migrate:reset` (`prisma migrate reset --force
  --skip-seed`).
- Seed: `npm run db:seed` (`node prisma/seed.js`).
- Internal health check: `test -f /usr/share/nginx/html/index.html && wget -qO-
  http://127.0.0.1:5173` inside the `web` service.
- Public health check: `GET https://pricely.grmeireles.dev` expecting `2xx`.
- Backup: `pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner`, verified
  with `pg_restore --list`, retained 14 days (`-mtime +14 -delete`).

These become the values in Pricely's own `.github/deploy/homolog.yml` (migration phase), not
anything hardcoded centrally.
