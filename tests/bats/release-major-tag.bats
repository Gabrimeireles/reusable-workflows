#!/usr/bin/env bats
# Exercises the exact ancestry-check logic release.yml's "Move floating major tag" step uses
# (docs/adr/0004-versioning-strategy.md amendment), against a real throwaway local git repo —
# no network, no real GitHub tag, per Constitution Principle X.

setup() {
  REPO="$(mktemp -d)"
  cd "$REPO" || exit 1
  git init -q -b master
  git config user.email "test@example.com"
  git config user.name "Test"
}

teardown() {
  rm -rf "$REPO"
}

# Mirrors release.yml's decision (not the git push, which needs a real remote).
decide_move() {
  local major="$1"
  local new_commit="$2"
  if git rev-parse "$major" >/dev/null 2>&1; then
    local current
    current=$(git rev-parse "${major}^{commit}")
    if [ "$current" = "$new_commit" ]; then
      echo "unchanged"
    elif git merge-base --is-ancestor "$current" "$new_commit"; then
      echo "move"
    else
      echo "skip"
    fi
  else
    echo "create"
  fi
}

@test "creates the floating tag when it doesn't exist yet" {
  git commit -q --allow-empty -m "first"
  C1=$(git rev-parse HEAD)
  run decide_move v1 "$C1"
  [ "$output" = "create" ]
}

@test "moves the floating tag forward when the new commit descends from it" {
  git commit -q --allow-empty -m "first"
  C1=$(git rev-parse HEAD)
  git tag v1 "$C1"
  git commit -q --allow-empty -m "second"
  C2=$(git rev-parse HEAD)
  run decide_move v1 "$C2"
  [ "$output" = "move" ]
}

@test "skips moving when the new commit is not a descendant (out-of-order hotfix)" {
  git commit -q --allow-empty -m "first"
  C1=$(git rev-parse HEAD)
  git commit -q --allow-empty -m "second"
  C2=$(git rev-parse HEAD)
  git tag v1 "$C2"
  # A hotfix branched from the OLDER commit C1, never merged forward — its commit is not a
  # descendant of what v1 currently points to (C2).
  git checkout -q -b hotfix "$C1"
  git commit -q --allow-empty -m "hotfix"
  HOTFIX=$(git rev-parse HEAD)
  run decide_move v1 "$HOTFIX"
  [ "$output" = "skip" ]
}

@test "reports unchanged when the new commit already is the current target" {
  git commit -q --allow-empty -m "first"
  C1=$(git rev-parse HEAD)
  git tag v1 "$C1"
  run decide_move v1 "$C1"
  [ "$output" = "unchanged" ]
}

@test "release.yml never moves the major tag for a prerelease" {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  run grep -q "inputs.update_major_tag && !inputs.prerelease" "$REPO_ROOT/.github/workflows/release.yml"
  [ "$status" -eq 0 ]
}
