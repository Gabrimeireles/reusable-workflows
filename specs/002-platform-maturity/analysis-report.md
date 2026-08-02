# Cross-Artifact Analysis Report — Iteration 2 (`/speckit.analyze` equivalent)

**Scope**: `spec.md`, `plan.md`, `tasks.md`, ADRs 0004 (amended), 0007–0010, against each other
and against iteration 1's untouched artifacts.

## Finding 1: `spec.md`'s own edge case about `v1` moving backward was left unresolved in `plan.md`/`tasks.md`

**Where found**: `spec.md` Edge Cases explicitly flags "what happens when `update_major_tag`
would move `v1` backward (e.g. a hotfix release tagged from an older branch)?" and defers the
answer to `/speckit-plan`. Neither `plan.md` nor `tasks.md` T170 actually answered it — T170 only
specified *when* to skip the move (prerelease, opt-out input), not an ancestry check.

**Resolution**: `release.yml`'s auto-move step MUST check that the new commit is a descendant of
(or equal to) `v1`'s current target (`git merge-base --is-ancestor <current-v1-sha>
<new-commit>`) before force-moving it; if not, it skips the move and prints a clear warning
naming both commits, rather than silently regressing the floating tag. `tasks.md` T170 updated
below; ADR 0004's amendment text updated to state this explicitly.

## Finding 2: `validate-config.mjs`'s role quietly expands from pure stdin/stdout to filesystem-aware

**Where found**: `tasks.md` T102 asks the validator to check `fs.existsSync` for
Dockerfile/context/compose paths and shell out to `yq` for Compose service names — but ADR 0003
(iteration 1) and ADR 0007 both describe/imply a "pure function on JSON in, JSON/errors out"
tool. This isn't wrong, but it's an undocumented scope expansion that a future reader of ADR 0003
would be confused by.

**Resolution**: Not a design flaw — filesystem/Compose-aware checks are exactly what spec.md
User Story 5 asks for, and `load-config`'s composite action already runs from the caller's
checked-out repository root, so relative paths resolve correctly. Documented explicitly (this
report + a one-line note added to ADR 0003 pointing at this evolution) rather than left implicit.

## Finding 3: `run-database-command` is still named in ADR 0005's prose

**Where found**: ADR 0005 ("Project-Specific Commands Are Opaque Strings the Caller Owns") names
`run-database-command` several times; ADR 0009 renames it to `run-remote-command`.

**Resolution**: Cosmetic, tracked as part of T130/T181 (documentation pass) rather than a new
task — ADR 0005's prose gets a one-line update pointing at the rename during implementation, not
a re-architecture.

## Non-findings (checked, no issue)

- Plugin resolution order (config always wins; later-declared plugin wins among plugins) is
  stated consistently in ADR 0007, `spec.md` FR-012/Edge Cases, and `tasks.md` T104.
- `docker-build.yml`'s and the three legacy workflows' backward-compatibility posture (FR-090)
  is consistent across `plan.md`'s Constitution Check and every ADR touching build/matrix.
- `deployment-summary`'s contract change (raw inputs → manifest JSON) is internal-only (no
  external caller of this composite action exists), so it needs no versioning treatment.
- The manifest's exclusion of secret *contents* (only checksums) is consistent between FR-030,
  FR-063, and ADR 0010's consequences section.

## Actions taken

- [x] `tasks.md` T170 updated with the ancestry-check requirement.
- [x] `docs/adr/0004-versioning-strategy.md` amendment text updated to state the ancestry check.
- [x] This report committed as the analyze-phase record before implementation begins.
