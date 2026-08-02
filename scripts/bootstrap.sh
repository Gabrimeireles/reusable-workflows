#!/usr/bin/env bash
# Idempotent local dev environment check/installer for this repository.
# Never installs anything without first checking whether it's already present,
# and never runs a privileged install without printing what it's about to do.
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$1" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
APT_MISSING=()

check_or_queue_apt() {
  local bin="$1" pkg="$2"
  if have "$bin"; then
    ok "$bin found ($(command -v "$bin"))"
  else
    warn "$bin not found (package: $pkg)"
    APT_MISSING+=("$pkg")
  fi
}

log "Checking required and recommended tools..."

# --- gh (GitHub CLI) ---
if have gh; then
  ok "gh found ($(gh --version | head -1))"
else
  warn "gh (GitHub CLI) not found. Install: https://cli.github.com/"
fi

# --- git ---
if have git; then
  ok "git found ($(git --version))"
else
  err "git is required and was not found."
  exit 1
fi

# --- docker / compose ---
check_or_queue_apt docker docker.io
if have docker && docker compose version >/dev/null 2>&1; then
  ok "docker compose (v2 plugin) found"
elif have docker; then
  warn "docker found but 'docker compose' (v2) is not available; install the compose plugin"
fi

# --- Node.js (needed by validate-config.mjs and docker-build.yml's version extraction) ---
if have node; then
  ok "node found ($(node --version))"
else
  warn "node not found. Install Node.js 20+ (e.g. via nvm) — required by .github/scripts/validate-config.mjs"
fi

# --- uv / uvx (Spec Kit) ---
if have uv && have uvx; then
  ok "uv/uvx found ($(uv --version))"
else
  warn "uv not found. Spec Kit commands (uvx --from git+https://github.com/github/spec-kit.git specify ...) need it."
  warn "Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
fi

# --- actionlint ---
if have actionlint; then
  ok "actionlint found ($(actionlint -version 2>&1 | head -1))"
else
  warn "actionlint not found."
  echo "  Suggested install (review before running):"
  echo "    bash <(curl https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)"
fi

# --- shellcheck ---
check_or_queue_apt shellcheck shellcheck

# --- yamllint ---
if have yamllint; then
  ok "yamllint found ($(yamllint --version))"
else
  warn "yamllint not found."
  echo "  Suggested install (review before running): pipx install yamllint  (or: pip install --user yamllint)"
fi

# --- yq / jq ---
check_or_queue_apt jq jq
if have yq; then
  ok "yq found ($(yq --version 2>&1))"
else
  warn "yq not found."
  echo "  Suggested install (review before running):"
  echo "    sudo snap install yq   # or see https://github.com/mikefarah/yq#install"
fi

# --- bats-core ---
if have bats; then
  ok "bats found ($(bats --version))"
else
  warn "bats (bats-core) not found."
  echo "  Suggested install (review before running): sudo apt-get install bats"
  echo "  or: git clone https://github.com/bats-core/bats-core.git && ./bats-core/install.sh /usr/local"
fi

# --- act (optional) ---
if have act; then
  ok "act found ($(act --version))"
else
  warn "act not found (optional; used only for local smoke tests of docker-build.yml)."
fi

if [ "${#APT_MISSING[@]}" -gt 0 ] && [ "$OS" = "Linux" ] && have apt-get; then
  echo
  warn "The following apt packages appear to be missing: ${APT_MISSING[*]}"
  echo "  Suggested command (review before running):"
  echo "    sudo apt-get update && sudo apt-get install -y ${APT_MISSING[*]}"
fi

echo
log "Bootstrap check complete. Nothing was installed automatically; review the suggestions above."
