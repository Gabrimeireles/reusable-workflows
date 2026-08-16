#!/usr/bin/env bash
# Propagates a small, fixed set of SHARED account-level secrets (GHCR_PAT, Tailscale OAuth
# creds, deploy host/user/key — values that are identical across every project on the same
# homeserver) into multiple GitHub repos in one shot, so rotating a leaked credential is one
# command instead of visiting N repos by hand.
#
# Deliberately does NOT touch per-project secrets (COMPOSE_ENV_EXTRA, ENV_FILE_*) — those differ
# per project, and syncing them would silently overwrite one project's database password with
# another's. See docs/secrets-and-environments.md for the full rationale, including why this
# can't instead live as logic inside a reusable workflow (GitHub Actions never lets a called
# workflow read its own hosting repo's secrets).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SECRETS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/reusable-workflows/secrets"
DEFAULT_REPOS_FILE="$SCRIPT_DIR/sync-secrets.repos"

log()  { printf '\033[1;34m[sync-secrets]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$1" >&2; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$1" >&2; }

usage() {
  cat <<EOF
Usage: sync-secrets.sh [options]

Propagates shared secret files from a local directory into one or more GitHub repos via
'gh secret set'. Intended for account-level credentials identical across every project
(GHCR_PAT, TS_OAUTH_CLIENT_ID, TS_OAUTH_SECRET, DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY) —
NOT for per-project secrets like COMPOSE_ENV_EXTRA or ENV_FILE_*.

Options:
  --secrets-dir DIR   Directory with one file per secret name.
                       Default: $DEFAULT_SECRETS_DIR
  --repos-file FILE   One "owner/repo" per line, # comments allowed.
                       Default: $DEFAULT_REPOS_FILE
  --repo owner/repo   Add a single target repo (repeatable; combines with --repos-file)
  --only NAME1,NAME2  Restrict to these secret names (default: every file in --secrets-dir)
  --dry-run           Print what would be set, without calling gh or reading any secret value
  -h, --help          Show this help

One-time setup:
  mkdir -p "$DEFAULT_SECRETS_DIR"
  chmod 700 "$DEFAULT_SECRETS_DIR"
  printf '%s' "ghp_xxx" > "$DEFAULT_SECRETS_DIR/GHCR_PAT"
  chmod 600 "$DEFAULT_SECRETS_DIR"/*
  cp scripts/sync-secrets.repos.example scripts/sync-secrets.repos   # then edit the repo list

Rotating a leaked or expiring credential:
  1. Overwrite the one file in --secrets-dir with the new value.
  2. Re-run: sync-secrets.sh --only THAT_NAME
EOF
}

resolve_secret_names() {
  local dir="$1" only="$2"
  if [ -n "$only" ]; then
    IFS=',' read -ra names <<< "$only"
    printf '%s\n' "${names[@]}"
    return 0
  fi
  [ -d "$dir" ] || return 0
  find "$dir" -maxdepth 1 -type f -printf '%f\n' | sort
}

resolve_repos() {
  local file="$1"
  shift
  local extra=("$@")
  local repos=()
  if [ -f "$file" ]; then
    while IFS= read -r line; do
      line="${line%%#*}"
      # trim leading/trailing whitespace without spawning a subprocess
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [ -n "$line" ] && repos+=("$line")
    done < "$file"
  fi
  repos+=("${extra[@]}")
  if [ "${#repos[@]}" -eq 0 ]; then
    return 0
  fi
  printf '%s\n' "${repos[@]}" | awk '!seen[$0]++'
}

valid_repo_format() {
  [[ "$1" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]
}

check_secrets_dir_perms() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  if find "$dir" -maxdepth 0 -perm -077 2>/dev/null | grep -q .; then
    warn "$dir is readable by group/other. Recommended: chmod 700 '$dir' && chmod 600 '$dir'/*"
  fi
}

SECRETS_DIR="$DEFAULT_SECRETS_DIR"
REPOS_FILE="$DEFAULT_REPOS_FILE"
EXTRA_REPOS=()
ONLY_NAMES=""
DRY_RUN=0

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --secrets-dir) SECRETS_DIR="$2"; shift 2 ;;
      --repos-file) REPOS_FILE="$2"; shift 2 ;;
      --repo) EXTRA_REPOS+=("$2"); shift 2 ;;
      --only) ONLY_NAMES="$2"; shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) err "Unknown argument: $1"; usage; exit 1 ;;
    esac
  done
}

main() {
  mapfile -t names < <(resolve_secret_names "$SECRETS_DIR" "$ONLY_NAMES")
  if [ "${#names[@]}" -eq 0 ]; then
    err "No secret names to sync. Checked --secrets-dir '$SECRETS_DIR' (empty or missing) and --only was not given."
    exit 1
  fi

  mapfile -t repos < <(resolve_repos "$REPOS_FILE" "${EXTRA_REPOS[@]}")
  if [ "${#repos[@]}" -eq 0 ]; then
    err "No target repos. Checked --repos-file '$REPOS_FILE' (empty or missing) and no --repo given."
    exit 1
  fi

  for r in "${repos[@]}"; do
    if ! valid_repo_format "$r"; then
      err "Not a valid 'owner/repo': '$r'"
      exit 1
    fi
  done

  log "Secrets: ${names[*]}"
  log "Repos:   ${repos[*]}"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run — no gh calls will be made, no secret file will be read."
    for r in "${repos[@]}"; do
      for n in "${names[@]}"; do
        echo "  would set: $n -> $r"
      done
    done
    return 0
  fi

  check_secrets_dir_perms "$SECRETS_DIR"

  if ! command -v gh >/dev/null 2>&1; then
    err "gh (GitHub CLI) not found."
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    err "gh is not authenticated. Run: gh auth login"
    exit 1
  fi

  local total=0 failures=0
  for n in "${names[@]}"; do
    local file="$SECRETS_DIR/$n"
    if [ ! -f "$file" ]; then
      warn "Skipping '$n': no file at $file"
      continue
    fi
    for r in "${repos[@]}"; do
      total=$((total + 1))
      if gh secret set "$n" --repo "$r" < "$file" >/dev/null 2>&1; then
        ok "$n -> $r"
      else
        err "$n -> $r FAILED"
        failures=$((failures + 1))
      fi
    done
  done

  echo
  log "$((total - failures))/$total set successfully."
  [ "$failures" -eq 0 ]
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  parse_args "$@"
  main
fi
