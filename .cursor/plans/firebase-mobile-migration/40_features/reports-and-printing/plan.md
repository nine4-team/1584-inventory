## Goal
Produce parity-grade specs for `reports-and-printing`.

## Inputs to review (source of truth)
- Feature list entry: `40_features/feature_list.md` → Feature 12: `reports-and-printing`
- Sync engine spec (local-first + outbox + delta + change-signal): `40_features/sync_engine_spec.plan.md`
- Budget/accounting rollups entrypoints (reports links in Accounting tab): `40_features/budget-and-accounting/README.md`
- Canonical category attribution model (required; impacts summaries):
  - `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
  - `40_features/project-items/flows/inherited_budget_category_rules.md`

## Owned screens (list)
- `ProjectInvoice` — contract required? **yes**
  - why: correctness of invoiceable selection + itemized totals + share/print adaptation.
- `ClientSummary` — contract required? **yes**
  - why: rollup math + receipt-link rules + canonical attribution deltas.
- `PropertyManagementSummary` — contract required? **yes**
  - why: large list rendering + value totals + space/location inclusion.

## Cross-cutting dependencies (link)
- Sync architecture constraints (local-first + outbox + change-signal + delta): `40_features/sync_engine_spec.plan.md`
- Business profile read availability (branding for reports): `40_features/settings-and-admin/README.md`
- Canonical attribution model: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Screen contracts (required):
- `ui/screens/ProjectInvoice.md`
- `ui/screens/ClientSummary.md`
- `ui/screens/PropertyManagementSummary.md`

Prompt packs (required):
- `prompt_packs/README.md`
- `prompt_packs/<2–4 packs>.md`

## Prompt packs (copy/paste)
Recommended slices:
- Slice A: Invoice spec + screen contract (invoice lines, item totals, print/share)
- Slice B: Client summary spec + screen contract (rollups + receipt links + canonical attribution)
- Slice C: Property management summary spec + screen contract (items list + totals + print/share)

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (generate offline, stale-data UX, restart behavior).
- Cross-links are complete (reports ↔ budget/accounting ↔ attribution model ↔ settings business profile).

