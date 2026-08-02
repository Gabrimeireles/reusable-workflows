# Troubleshooting

## "Missing required secret: X"

The runtime validation caught a secret your config needs but your caller didn't supply (or
mapped to the wrong slot name). Check your `secrets:` map against
[`docs/caller-contract.md`](caller-contract.md) — remember `ENV_FILE_1..6` map **positionally**
to your config's `environmentFiles` list, not by the `secret:` label in the YAML (that field is
documentation only).

## "Deploy configuration ... failed validation"

`load-config` prints every schema violation it found. Common causes: a path containing `..`, a
project/service name with uppercase letters or underscores, more than 6 `environmentFiles`
entries, or a `database.enabled: true` block missing `migration.command`. Validate locally:

```sh
yq -o=json eval '.' .github/deploy/homolog.yml | node path/to/reusable-workflows/.github/scripts/validate-config.mjs
```

## "reset_database=true is only allowed on a workflow_dispatch run"

This is intentional (Constitution Principle VII / FR-030). Trigger the deploy via
`workflow_dispatch` with the reset input checked, not via `push`.

## SSH / `ssh-keyscan` failures

`setup-ssh` retries `ssh-keyscan` a bounded number of times before failing. Usual causes: the
host is unreachable from GitHub-hosted runners (check `use_tailscale`/firewall), or
`DEPLOY_HOST` is wrong. This never falls back to `StrictHostKeyChecking=no`.

## Health check fails after a successful-looking deploy

`health-check` prints the affected service's recent `docker compose logs` on failure — check the
run log for that. Common causes: the service takes longer to become ready than
`retries`×`intervalSeconds` allows (raise both in the config), or the health command/URL doesn't
match what the service actually exposes.

## Backup step fails ("PostgreSQL did not become ready")

Increase `ready_retries` isn't currently exposed as a config field — if this happens
consistently, the dependency service ordering or the container's own healthcheck may be the
real issue; check `docker compose logs <composeService>` on the server directly.

## "image_refs contains more than one distinct tag"

All images in one `deploy-stack.yml` call must share a single immutable tag (Principle V/VI
assumption — see [`docs/architecture.md`](architecture.md)). This means every `docker-build.yml`
call feeding into the same deploy must run against the same commit.

## My caller workflow references a "legacy" workflow — is that a problem?

No, if it's `CoGuide_PPS_BackEnd`, `CoGuide_PPS_FrontEnd`, or `Conecta_SLA` referencing
`docker-deploy-ssh.yml`/`github-release.yml`/`swagger-pages.yml` at a pinned tag — those are
intentionally kept unchanged (see [`README.md`](../README.md)). New projects should use
`ci-cd.yml` (or `deploy-stack.yml`/`release.yml` directly) instead.

## "unknown plugin 'X'"

Nothing under `.github/plugins/X/plugin.mjs` exists in the pinned version of this repository you
reference. Check the spelling and the shipped list in [`docs/plugins.md`](plugins.md), or that
you're pinned to a ref that actually includes the plugin you want.

## "unknown hook name"

Hook keys are a fixed set of twelve — see [`docs/hooks.md`](hooks.md). A typo (`pre_healtchek`)
or an invented name (`pre_launch_party`) fails validation with the exact list of valid names.

## "No image artifacts were collected — the build matrix produced nothing"

`ci-cd.yml`'s `collect` job found zero `image-*` artifacts after the `build` matrix ran. This
means every matrix instance either failed before reaching its artifact-upload step, or your
config's `images` list was empty (should already be rejected by schema validation upstream — if
you see this, check the `build` job's logs for the real underlying failure per image).

## "not a descendant" warning during a release

`release.yml`'s floating major-tag move was skipped because the new release commit isn't a
descendant of the tag's current target — usually means you tagged a release from an older branch
(e.g. a hotfix) than what `vMAJOR` currently points to. This is intentional (it would otherwise
regress the floating tag) — move the tag manually if you're sure it's what you want:
`git tag -f vMAJOR <commit> && git push origin vMAJOR --force`.

## Where's the digest/size for an image built via `docker-build.yml` directly (not `ci-cd.yml`)?

`digest`/`size` are always computed as job outputs; they only flow into the release manifest
when built through `ci-cd.yml`'s matrix (which threads `image_details` through to
`deploy-stack.yml`). A direct `docker-build.yml` + `deploy-stack.yml` caller (e.g. Pricely's
current draft) gets a manifest with `digest`/`sizeBytes` as `null` — read them from that build
job's own outputs instead if you need them.

## Something in this repository's own CI is failing

`make validate` reproduces `ci.yml` locally (actionlint, shellcheck on both standalone scripts
and composite-action steps, yamllint, node config-validator tests, bats specs). Run it before
opening a PR.
