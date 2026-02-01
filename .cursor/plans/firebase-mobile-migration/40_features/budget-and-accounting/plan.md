# Budget + Accounting (project rollups) — Plan

## Goal
Produce parity-grade specs for `budget-and-accounting`, explicitly incorporating the canonical attribution decisions in:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- `40_features/project-items/flows/inherited_budget_category_rules.md`

## Inputs to review (source of truth)
- Feature map entry: `40_features/feature_list.md` → “Budget + accounting rollups (project)”
- Sync engine spec: `sync_engine_spec.plan.md`
- Canonical attribution working doc: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- Item guardrails + attribution rules: `40_features/project-items/flows/inherited_budget_category_rules.md`

## Owned screens (list)
- Project budget section (Budget / Accounting sub-tabs) — contract required? **no** (behavior is mostly rollup math + simple UI)
- Project list “budget preview” — contract required? **no** (delegates to same rollup logic in preview mode)

## Cross-cutting dependencies (link)
- `40_features/project-items/flows/inherited_budget_category_rules.md`
- `40_features/inventory-operations-and-lineage/README.md` (canonical row creation; referenced, not owned)
- `40_features/reports-and-printing/README.md` (report behavior; referenced, not owned)

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Prompt packs:
- `prompt_packs/README.md`
- `prompt_packs/chat_a_budget_rollup_math_and_canonical_attribution.md`
- `prompt_packs/chat_b_design_fee_identity_and_budget_categories_metadata.md`
- `prompt_packs/chat_c_accounting_rollups_and_reports_entrypoints.md`

## Prompt packs (copy/paste)
Create 3 slices so separate AI dev chats can implement/validate in parallel:

- Slice A: rollup math + local DB query shape + canonical item-driven attribution
- Slice B: design fee stable identity + category metadata strategy
- Slice C: accounting rollups + report entrypoints wiring

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Canonical attribution is explicitly item-driven and ignores canonical transaction category fields.
- Design fee specialness is keyed by a stable identifier.
- Offline behavior is explicit (computed from SQLite; no network required).
