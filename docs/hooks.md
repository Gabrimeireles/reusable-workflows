# Lifecycle Hooks

Twelve named points in the build/deploy lifecycle where you can run your own command, without
the platform needing to know what it does.

## The twelve hooks

| Hook | Runs | Where |
|---|---|---|
| `pre_build` / `post_build` | Around each image's build | GitHub-hosted runner (inside `ci-cd.yml`'s matrix `build` job, around the `docker-build.yml` call) |
| `pre_backup` / `post_backup` | Around the database backup | Remote host |
| `pre_migration` / `post_migration` | Around migration/reset (whichever runs) | Remote host |
| `pre_deploy` / `post_deploy` | Around the whole remote deploy sequence (`pre_deploy` right after SSH is ready; `post_deploy` right after services are recreated) | Remote host |
| `pre_healthcheck` / `post_healthcheck` | Around the health checks | Remote host |
| `pre_cleanup` / `post_cleanup` | Around dangling-image pruning | Remote host |

An undeclared hook is a no-op — it costs nothing to leave one out.

## Declaring a hook

Three equivalent forms:

```yaml
hooks:
  post_deploy: "curl -X POST https://api.example.com/cache/purge"   # inline command

  pre_healthcheck:
    script: "./scripts/warm-cache.sh"                                # script in your repo

  # or: inherited from a declared plugin (docs/plugins.md) — no entry needed here at all
```

All three resolve to exactly one final command string before any workflow step runs it — the
executor (`run-remote-command` for the ten remote hooks, or a plain step for `pre_build`/
`post_build`) never knows or cares which form you used.

## Execution model

- **Remote hooks** run via the same safe mechanism as migration/reset/seed
  (`docs/adr/0005-project-specific-commands.md`): the command is streamed to the remote shell
  over SSH stdin, never interpolated directly into a shell string. A remote hook with no target
  Compose service runs directly on the remote host (in the deploy directory); this is what makes
  hooks usable for things that aren't tied to one container.
- **Build hooks** (`pre_build`/`post_build`) run as regular steps in the matrix build job, once
  per image, using whatever tools are available on the GitHub-hosted runner.
- A failing hook fails the run, the same as any other step — there's no silent-failure mode.

## Resolution order with plugins

If a plugin declares a default for a hook you haven't declared yourself, the plugin's hook runs.
Your own declaration for the same hook name always wins. See [`docs/plugins.md`](plugins.md)
for the full merge order when multiple plugins are involved.
