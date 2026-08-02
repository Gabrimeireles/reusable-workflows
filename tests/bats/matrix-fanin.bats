#!/usr/bin/env bats
# Unit-tests the exact jq merge expression ci-cd.yml's "collect" job uses to fan-in matrix build
# artifacts into the single image_refs JSON deploy-stack.yml expects (ADR 0008), without needing
# a real GitHub Actions matrix run.

setup() {
  TMP_DIR="$(mktemp -d)"
}

teardown() {
  rm -rf "$TMP_DIR"
}

merge() {
  jq -sc 'map({(.id): (.image + ":" + .tag)}) | add' "$@"
}

@test "merges a single image artifact" {
  echo '{"id":"app","image":"ghcr.io/o/app","tag":"sha-abc1234","digest":"sha256:x","size":"100"}' > "$TMP_DIR/a.json"
  run merge "$TMP_DIR/a.json"
  [ "$status" -eq 0 ]
  [ "$output" = '{"app":"ghcr.io/o/app:sha-abc1234"}' ]
}

@test "merges four image artifacts into one object keyed by id" {
  echo '{"id":"app","image":"ghcr.io/o/app","tag":"sha-abc1234"}' > "$TMP_DIR/1.json"
  echo '{"id":"api","image":"ghcr.io/o/api","tag":"sha-abc1234"}' > "$TMP_DIR/2.json"
  echo '{"id":"worker","image":"ghcr.io/o/worker","tag":"sha-abc1234"}' > "$TMP_DIR/3.json"
  echo '{"id":"web","image":"ghcr.io/o/web","tag":"sha-abc1234"}' > "$TMP_DIR/4.json"
  run merge "$TMP_DIR"/*.json
  [ "$status" -eq 0 ]
  KEYS=$(echo "$output" | jq -r 'keys | sort | join(",")')
  [ "$KEYS" = "api,app,web,worker" ]
}

@test "resulting object is valid JSON consumable by fromJSON()" {
  echo '{"id":"a","image":"ghcr.io/o/a","tag":"sha-1"}' > "$TMP_DIR/1.json"
  echo '{"id":"b","image":"ghcr.io/o/b","tag":"sha-1"}' > "$TMP_DIR/2.json"
  run merge "$TMP_DIR"/*.json
  echo "$output" | jq -e 'type == "object"'
}
