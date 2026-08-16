#!/usr/bin/env bats
# Tests scripts/sync-secrets.sh's pure logic (name/repo resolution, format validation) by
# sourcing it (guarded so sourcing never executes parse_args/main), plus a real dry-run
# invocation that must never shell out to `gh`.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  SCRIPT="$REPO_ROOT/scripts/sync-secrets.sh"
  WORK="$(mktemp -d)"
}

teardown() {
  rm -rf "$WORK"
}

@test "sourcing the script defines functions but runs nothing" {
  run bash -c "source '$SCRIPT'; echo sourced-ok"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sourced-ok"* ]]
}

@test "resolve_secret_names: --only takes precedence and preserves given order" {
  run bash -c "source '$SCRIPT'; resolve_secret_names /does/not/exist 'B,A,C'"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'B\nA\nC')" ]
}

@test "resolve_secret_names: lists files in secrets dir, sorted, when --only is empty" {
  touch "$WORK/GHCR_PAT" "$WORK/DEPLOY_HOST" "$WORK/TS_OAUTH_SECRET"
  run bash -c "source '$SCRIPT'; resolve_secret_names '$WORK' ''"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'DEPLOY_HOST\nGHCR_PAT\nTS_OAUTH_SECRET')" ]
}

@test "resolve_secret_names: missing dir and empty --only yields nothing" {
  run bash -c "source '$SCRIPT'; resolve_secret_names '$WORK/nope' ''"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "resolve_repos: reads owner/repo lines, ignoring blanks and # comments" {
  cat > "$WORK/repos" <<'EOF'
# a comment
Gabrimeireles/Foundrix

Gabrimeireles/Pricely   # trailing comment
EOF
  run bash -c "source '$SCRIPT'; resolve_repos '$WORK/repos'"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'Gabrimeireles/Foundrix\nGabrimeireles/Pricely')" ]
}

@test "resolve_repos: combines file entries with extra --repo args and dedups" {
  cat > "$WORK/repos" <<'EOF'
Gabrimeireles/Foundrix
EOF
  run bash -c "source '$SCRIPT'; resolve_repos '$WORK/repos' 'Gabrimeireles/Foundrix' 'Gabrimeireles/Pricely'"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'Gabrimeireles/Foundrix\nGabrimeireles/Pricely')" ]
}

@test "resolve_repos: missing file and no extras yields nothing" {
  run bash -c "source '$SCRIPT'; resolve_repos '$WORK/nope'"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "valid_repo_format: accepts owner/repo" {
  run bash -c "source '$SCRIPT'; valid_repo_format 'Gabrimeireles/Foundrix'"
  [ "$status" -eq 0 ]
}

@test "valid_repo_format: rejects missing slash, extra segment, and embedded space" {
  run bash -c "source '$SCRIPT'; valid_repo_format 'Foundrix'"
  [ "$status" -ne 0 ]
  run bash -c "source '$SCRIPT'; valid_repo_format 'a/b/c'"
  [ "$status" -ne 0 ]
  run bash -c "source '$SCRIPT'; valid_repo_format 'a b/c'"
  [ "$status" -ne 0 ]
}

@test "dry run lists every secret x repo pair and never invokes gh" {
  mkdir -p "$WORK/secrets" "$WORK/bin"
  touch "$WORK/secrets/GHCR_PAT" "$WORK/secrets/DEPLOY_HOST"
  cat > "$WORK/repos" <<'EOF'
Gabrimeireles/Foundrix
Gabrimeireles/Pricely
EOF
  # A `gh` on PATH that proves it was never called, by leaving a marker if it is.
  cat > "$WORK/bin/gh" <<EOF
#!/usr/bin/env bash
touch "$WORK/gh-was-called"
exit 1
EOF
  chmod +x "$WORK/bin/gh"

  run env PATH="$WORK/bin:$PATH" bash "$SCRIPT" \
    --dry-run --secrets-dir "$WORK/secrets" --repos-file "$WORK/repos"
  [ "$status" -eq 0 ]
  [ ! -e "$WORK/gh-was-called" ]
  [[ "$output" == *"would set: DEPLOY_HOST -> Gabrimeireles/Foundrix"* ]]
  [[ "$output" == *"would set: DEPLOY_HOST -> Gabrimeireles/Pricely"* ]]
  [[ "$output" == *"would set: GHCR_PAT -> Gabrimeireles/Foundrix"* ]]
  [[ "$output" == *"would set: GHCR_PAT -> Gabrimeireles/Pricely"* ]]
}

@test "errors clearly when there are no secret names to sync" {
  run bash "$SCRIPT" --dry-run --secrets-dir "$WORK/nope" --repos-file "$WORK/also-nope"
  [ "$status" -ne 0 ]
  [[ "$output" == *"No secret names to sync"* ]]
}

@test "errors clearly when there are no target repos" {
  mkdir -p "$WORK/secrets"
  touch "$WORK/secrets/GHCR_PAT"
  run bash "$SCRIPT" --dry-run --secrets-dir "$WORK/secrets" --repos-file "$WORK/nope"
  [ "$status" -ne 0 ]
  [[ "$output" == *"No target repos"* ]]
}

@test "errors clearly on a malformed repo entry instead of silently skipping it" {
  mkdir -p "$WORK/secrets"
  touch "$WORK/secrets/GHCR_PAT"
  cat > "$WORK/repos" <<'EOF'
not-a-valid-repo
EOF
  run bash "$SCRIPT" --dry-run --secrets-dir "$WORK/secrets" --repos-file "$WORK/repos"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Not a valid 'owner/repo'"* ]]
}

@test "--help exits 0 and documents --dry-run" {
  run bash "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--dry-run"* ]]
}
