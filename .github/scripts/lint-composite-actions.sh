#!/usr/bin/env bash
# actionlint does not understand composite action.yml files (only .github/workflows/*.yml), so
# this extracts every bash `run:` step from every composite action and shellchecks it directly.
set -euo pipefail

if ! command -v yq >/dev/null 2>&1; then
  echo "yq is required" >&2
  exit 1
fi
if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck is required" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STATUS=0
COUNT=0

while IFS= read -r -d '' action_file; do
  n_steps=$(yq eval '.runs.steps | length' "$action_file")
  for ((i = 0; i < n_steps; i++)); do
    shell=$(yq eval ".runs.steps[$i].shell // \"\"" "$action_file")
    if [ "$shell" != "bash" ]; then
      continue
    fi
    script_file="$TMP_DIR/$(basename "$(dirname "$action_file")")-step${i}.sh"
    {
      echo "#!/usr/bin/env bash"
      yq eval ".runs.steps[$i].run" "$action_file"
    } > "$script_file"
    COUNT=$((COUNT + 1))
    if ! shellcheck --shell=bash "$script_file"; then
      echo "  ^-- from $action_file (step $i)" >&2
      STATUS=1
    fi
  done
done < <(find "$REPO_ROOT/.github/actions" -name 'action.yml' -print0)

echo "Checked $COUNT bash step(s) across composite actions."
exit $STATUS
