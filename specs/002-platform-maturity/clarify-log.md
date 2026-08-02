# Clarification Log: Platform Maturity (Iteration 2)

Three open questions were raised in `architecture-analysis.md` §6 and put to the user directly
(not guessed) since each was a genuine scope/complexity tradeoff without a clearly superior
default.

## Q1: Model ports in the declarative schema, to validate duplicates?

**Decision: No.** Ports stay a Compose/`.env` concern, outside the platform's declarative model.
"Duplicate ports" is dropped from the semantic-validation scope for this iteration — it would be
new scope (the schema has never modeled ports), not a fix to something already there.

## Q2: Health checks — keep the 4 inline slots, or move to matrix + artifact fan-in?

**Decision: Keep the 4 inline slots.** Health checks are cheap and rarely exceed 1-2 per project
in practice; a matrix would need the same artifact-based fan-in complexity the build matrix
needs (§3.1 of the analysis), for no real benefit at this scale. The existing per-slot structure
is simplified per §3.10.2-3 of the analysis (JSON-slice inputs to composite actions) but the cap
and the inline-steps shape remain.

## Q3: Should the `v1` floating tag move automatically on each `1.x.y` release?

**Decision: Automatic, with opt-out.** `release.yml` gains a step that force-moves `refs/tags/v1`
(or `v2`, etc., matching the released major) to the newly-tagged commit immediately after
tagging, unless the release is a prerelease. A boolean input (default `true`) allows disabling
this per run. This is a deliberate amendment to `docs/adr/0004-versioning-strategy.md`, recorded
there directly rather than silently changed.
