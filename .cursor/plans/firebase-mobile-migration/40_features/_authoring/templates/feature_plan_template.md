# Feature plan template (`40_features/<feature>/plan.md`)

## Goal
Produce parity-grade specs for `<feature_slug>`.

## Inputs to review (source of truth)
- Feature map entry: `<link/section>`
- Sync engine spec: `sync_engine_spec.plan.md`
- Relevant existing plans (if any): `<paths>`

## Owned screens (list)
- `<ScreenName>` — contract required? (yes/no) — why
- `<ScreenName>` — contract required? (yes/no) — why

## Cross-cutting dependencies (link)
- `40_features/_cross_cutting/<...>`

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Screen contracts (required):
- `ui/screens/<screen>.md`

Optional extras:
- `flows/<flow>.md`
- `data/*.md`
- `tests/test_cases.md`

## Prompt packs (copy/paste)
Create `prompt_packs/` with 2–4 slices. Each slice must include:
- exact output files
- source-of-truth code pointers (file paths)
- evidence rule

Recommended slices:
- Slice A: shared UI component/patterns (goes to `_cross_cutting`)
- Slice B: the highest-ambiguity screen contract
- Slice C: offline/retry/conflict/media semantics for the feature

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (pending + restart + reconnect).
- Collaboration behavior is explicit and uses change-signal + delta.
- Cross-links are complete.

