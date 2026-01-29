# Chat B — Design fee identity + budget category metadata strategy

## Goal
Lock down the “design fee stays special” model in a way that is stable under renames and compatible with offline-first constraints.

## Critical constraints (must obey)
- Design fee is tracked as **received**, not spent.
- Design fee specialness must be bound to a **stable identifier** (slug/metadata), not a mutable display name.
  - Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- Canonical inventory transactions must not require a user-facing category.

## Exact output files
Update only:
- `40_features/budget-and-accounting/feature_spec.md`
- `40_features/budget-and-accounting/acceptance_criteria.md`

If you need to add a shared data contract doc, add:
- `20_data/budget_categories_metadata.md`

## What to produce
- A concrete proposal for “stable identifier” representation, such as:
  - `budgetCategory.systemTag = 'design_fee'`, OR
  - `budgetCategory.slug = 'design-fee'`, OR
  - a separate `account.settings.designFeeCategoryId` pointer
- Explicit rules for:
  - which transactions count toward design fee received
  - how to identify those transactions without name matching
- Any migration guardrails (if needed) should be captured as “out of scope” unless required by correctness.

## Parity evidence (web sources)
- Web design fee detection uses name heuristics:
  - `src/components/ui/BudgetProgress.tsx` (`isDesignFeeCategory`)

## Evidence rule
For each non-obvious behavior, include either parity evidence or an intentional delta statement.

