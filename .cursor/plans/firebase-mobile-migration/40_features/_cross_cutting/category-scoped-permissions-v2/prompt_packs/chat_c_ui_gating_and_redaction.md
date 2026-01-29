# Prompt Pack — Chat C: UI gating + canonical Transaction Detail redaction (Roles v2)

## Goal
Implement the UX surface for Roles v2 without changing the underlying business model:

- category pickers/filters show only `allowedCategoryIds` for scoped users
- canonical `INV_*` Transaction Detail shows **only** in-scope linked items (hide out-of-scope items completely)

## Required reading (ground truth)
- Spec: `40_features/_cross_cutting/category-scoped-permissions-v2/feature_spec.md`
- Canonical attribution evidence (do not change):
  - `40_features/project-items/flows/inherited_budget_category_rules.md`
  - `40_features/project-transactions/feature_spec.md`
  - `40_features/budget-and-accounting/feature_spec.md`

## Outputs (required)
- Update UI behavior so that for scoped users:
  - all category pickers/filters use `allowedCategoryIds`
  - canonical transaction detail:
    - displays only in-scope linked items
    - does not show out-of-scope item counts or redacted placeholders
    - uses canonical attribution semantics for category-related UI (item-driven)

## Constraints
- UI gating is required but not sufficient; do not weaken server-side enforcement assumptions.
- No new product capabilities; implement Roles v2 only.

