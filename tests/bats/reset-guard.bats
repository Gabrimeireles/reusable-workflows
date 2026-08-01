#!/usr/bin/env bats
# Exercises the same reset-guard logic embedded in deploy-stack.yml's "Reset guard" step
# (Principle VII / FR-030), extracted here into a standalone function so it's testable without
# spinning up an actual workflow run.

reset_guard() {
  local reset_database="$1" event_name="$2"
  if [ "$reset_database" = "true" ] && [ "$event_name" != "workflow_dispatch" ]; then
    echo "Refusing: reset_database=true on event '$event_name'" >&2
    return 1
  fi
  return 0
}

@test "reset forbidden on push" {
  run reset_guard "true" "push"
  [ "$status" -eq 1 ]
}

@test "reset forbidden on pull_request" {
  run reset_guard "true" "pull_request"
  [ "$status" -eq 1 ]
}

@test "reset allowed on workflow_dispatch" {
  run reset_guard "true" "workflow_dispatch"
  [ "$status" -eq 0 ]
}

@test "no reset requested is always allowed regardless of event" {
  run reset_guard "false" "push"
  [ "$status" -eq 0 ]
}

@test "deploy-stack.yml actually contains an equivalent guard (drift check)" {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  run grep -n "EVENT_NAME.*!=.*workflow_dispatch" "$REPO_ROOT/.github/workflows/deploy-stack.yml"
  [ "$status" -eq 0 ]
}
