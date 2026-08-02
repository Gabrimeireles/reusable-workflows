#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  source "$REPO_ROOT/.github/scripts/lib/image-tags.sh"
}

@test "lowercase_owner lowercases mixed-case owner" {
  result="$(lowercase_owner "Gabrimeireles")"
  [ "$result" = "gabrimeireles" ]
}

@test "owner_image builds full ghcr.io reference" {
  result="$(owner_image "Gabrimeireles" "pricely-backend")"
  [ "$result" = "ghcr.io/gabrimeireles/pricely-backend" ]
}

@test "sha_tag truncates to 7 characters with sha- prefix" {
  result="$(sha_tag "dd91057fc0ac8afcebbc7ae6ee1d1bdb65792e5a")"
  [ "$result" = "sha-dd91057" ]
}

@test "sha_tag handles a short sha without erroring" {
  result="$(sha_tag "abc123")"
  [ "$result" = "sha-abc123" ]
}

@test "should_push_floating_tag true when ref matches default branch" {
  run should_push_floating_tag "master" "master"
  [ "$status" -eq 0 ]
}

@test "should_push_floating_tag false when ref differs from default branch" {
  run should_push_floating_tag "feature-x" "master"
  [ "$status" -eq 1 ]
}
