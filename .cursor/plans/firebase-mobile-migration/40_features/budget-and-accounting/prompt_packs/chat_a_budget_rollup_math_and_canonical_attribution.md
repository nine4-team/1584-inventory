# Chat A — Budget rollup math + canonical attribution (item-driven)

## Goal
Specify and/or implement the budget rollup computation layer for the Firebase mobile app (SQLite source of truth), with the **canonical item-driven attribution** model.

## Critical constraints (must obey)
- UI reads from SQLite only; rollups must be derivable offline (`sync_engine_spec.plan.md`).
- Canonical inventory transactions (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`) must **not** require a user-facing category and must be attributed via **linked items’** `inheritedBudgetCategoryId`.
  - Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
  - Shared rules: `40_features/project-items/flows/inherited_budget_category_rules.md`

## Exact output files
Update only:
- `40_features/budget-and-accounting/feature_spec.md`
- `40_features/budget-and-accounting/acceptance_criteria.md`

If you need a shared contract doc (only if necessary), add:
- `40_features/_cross_cutting/budget_rollup_query_contract.md`

## What to produce
- A deterministic definition of:
  - overall spent (excluding design fee)
  - per-category spent (non-canonical + canonical)
  - overall budget denominator (sum of project category budgets)
- A local-DB join/query strategy sufficient to implement:
  - canonical attribution by `item.transactionId` join
  - grouping by `item.inheritedBudgetCategoryId`

## Parity evidence (web sources)
- Current budget rollup UI + math (note: we are intentionally deviating for canonical attribution):
  - `src/components/ui/BudgetProgress.tsx`
  - `src/components/ui/__tests__/BudgetProgress.test.tsx`
- Canonical transaction totals derive from item values:
  - `src/services/inventoryService.ts` (`computeCanonicalTransactionTotal`)

## Evidence rule
For each non-obvious behavior, include either:
- **Parity evidence**: “Observed in …” with file path + function/component, OR
- **Intentional delta**: explicitly state what changes and why (reference the working doc).

