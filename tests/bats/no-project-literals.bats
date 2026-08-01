#!/usr/bin/env bats
# Enforces Constitution Principle VIII: central workflows/actions must stay generic.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
}

@test "no project-specific literal drives actual behavior (default:/comparisons), only docs/examples" {
  # Constitution Principle VIII explicitly allows these words in documentation/example text
  # (like this very comment, or a `description:` field) — what's forbidden is a literal
  # driving behavior: a YAML default value, or a shell string comparison/assignment.
  run bash -c "
    grep -rniE 'pricely|prisma|conecta[_-]sla|coguide' \
      '$REPO_ROOT/.github/workflows' '$REPO_ROOT/.github/actions' '$REPO_ROOT/.github/scripts' \
      | grep -viE ':[0-9]+:\s*#|description:|descrição|e\.g\.|example|\"[A-Za-z ]*\", e\.g'
  "
  [ "$status" -ne 0 ]
}

@test "no secret value is ever echoed or printed directly (Principle III)" {
  run grep -rniE 'echo[^|>]*\$\{\{\s*secrets\.' \
    "$REPO_ROOT/.github/workflows" "$REPO_ROOT/.github/actions"
  [ "$status" -ne 0 ]
}

@test "no secret is ever written to GITHUB_OUTPUT via a bare echo of its raw expression" {
  run grep -rniE '\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}\s*>>\s*"?\$GITHUB_OUTPUT' \
    "$REPO_ROOT/.github/workflows" "$REPO_ROOT/.github/actions"
  [ "$status" -ne 0 ]
}
