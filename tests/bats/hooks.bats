#!/usr/bin/env bats
# Tests the hook-resolution jq expression deploy-stack.yml uses (inline command vs {script: ...}
# vs undeclared -> empty), and a drift-check that all 12 declared hook names actually have a
# wired step in deploy-stack.yml/ci-cd.yml.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
}

resolve_hook() {
  local config="$1" name="$2"
  jq -r ".hooks.${name} // \"\" | if type == \"object\" then \"bash \" + .script else . end" <<< "$config"
}

@test "inline command hook resolves to itself" {
  result="$(resolve_hook '{"hooks":{"post_deploy":"echo hi"}}' post_deploy)"
  [ "$result" = "echo hi" ]
}

@test "script hook resolves to bash <path>" {
  result="$(resolve_hook '{"hooks":{"post_build":{"script":"./scripts/x.sh"}}}' post_build)"
  [ "$result" = "bash ./scripts/x.sh" ]
}

@test "undeclared hook resolves to empty string (no-op)" {
  result="$(resolve_hook '{"hooks":{}}' pre_deploy)"
  [ "$result" = "" ]
}

@test "missing hooks object entirely resolves to empty string" {
  result="$(resolve_hook '{}' pre_deploy)"
  [ "$result" = "" ]
}

HOOK_NAMES="pre_build post_build pre_backup post_backup pre_migration post_migration pre_deploy post_deploy pre_healthcheck post_healthcheck pre_cleanup post_cleanup"

@test "every declared hook name has a wired step somewhere in deploy-stack.yml or ci-cd.yml/docker-build.yml" {
  for hook in $HOOK_NAMES; do
    run grep -rl "hook_${hook}\|${hook}_command" \
      "$REPO_ROOT/.github/workflows/deploy-stack.yml" \
      "$REPO_ROOT/.github/workflows/ci-cd.yml" \
      "$REPO_ROOT/.github/workflows/docker-build.yml"
    [ "$status" -eq 0 ]
  done
}

@test "run-remote-command supports host-level execution (empty service)" {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  run grep -q 'if \[ -n "\$SERVICE" \]' "$REPO_ROOT/.github/actions/run-remote-command/action.yml"
  [ "$status" -eq 0 ]
}
