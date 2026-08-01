#!/usr/bin/env bash
# Shared, unit-testable (tests/bats/docker-build-tags.bats) logic for computing the GHCR image
# owner/name and whether the floating tag should be pushed on this ref.
set -euo pipefail

# lowercase_owner OWNER
lowercase_owner() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# owner_image OWNER IMAGE_NAME
owner_image() {
  local owner_lower
  owner_lower="$(lowercase_owner "$1")"
  printf 'ghcr.io/%s/%s' "$owner_lower" "$2"
}

# sha_tag FULL_SHA
sha_tag() {
  printf 'sha-%s' "${1:0:7}"
}

# should_push_floating_tag REF_NAME DEFAULT_BRANCH
should_push_floating_tag() {
  [ "$1" = "$2" ]
}
