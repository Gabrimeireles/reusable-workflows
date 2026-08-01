.PHONY: bootstrap lint lint-actions lint-shell lint-yaml test test-node test-bats validate spec

bootstrap:
	bash scripts/bootstrap.sh

lint: lint-actions lint-shell lint-yaml

lint-actions:
	@command -v actionlint >/dev/null 2>&1 || { echo "actionlint not found; run 'make bootstrap'"; exit 1; }
	actionlint

lint-shell:
	@command -v shellcheck >/dev/null 2>&1 || { echo "shellcheck not found; run 'make bootstrap'"; exit 1; }
	@find .github/scripts scripts -type f \( -name '*.sh' -o -name '*.bash' \) -print0 \
		| xargs -0 -r shellcheck
	bash .github/scripts/lint-composite-actions.sh

lint-yaml:
	@command -v yamllint >/dev/null 2>&1 || { echo "yamllint not found; run 'make bootstrap'"; exit 1; }
	yamllint .

test: test-node test-bats

test-node:
	@command -v node >/dev/null 2>&1 || { echo "node not found; run 'make bootstrap'"; exit 1; }
	node --test tests/unit/*.test.mjs

test-bats:
	@command -v bats >/dev/null 2>&1 || { echo "bats not found; run 'make bootstrap'"; exit 1; }
	bats tests/bats

validate: lint test
	@echo "All lint and test targets passed."

spec:
	@echo "Spec Kit commands (run via your coding agent, e.g. Claude Code):"
	@echo "  /speckit-constitution  - update .specify/memory/constitution.md"
	@echo "  /speckit-specify       - create/update specs/<NNN-feature>/spec.md"
	@echo "  /speckit-clarify       - resolve open questions in the current spec"
	@echo "  /speckit-plan          - produce plan.md, research.md, data-model.md, contracts/"
	@echo "  /speckit-tasks         - produce tasks.md"
	@echo "  /speckit-analyze       - cross-check spec/plan/tasks for inconsistencies"
	@echo "  /speckit-implement     - execute tasks.md"
	@echo "CLI form: uvx --from git+https://github.com/github/spec-kit.git specify <command>"
