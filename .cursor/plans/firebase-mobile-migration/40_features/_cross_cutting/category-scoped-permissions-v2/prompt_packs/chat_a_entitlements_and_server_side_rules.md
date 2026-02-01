# Prompt Pack — Chat A: Entitlements + server-side enforcement (Roles v2)

## Goal
Implement the **server-side source-of-truth** for Roles v2 category-scoped permissions:

- membership entitlement shape (`isAdmin`, `allowedCategoryIds`)
- item read/write enforcement (including “own uncategorized” exception)
- transaction read enforcement:
  - non-canonical: `transaction.categoryId ∈ allowedCategoryIds`
  - canonical `INV_*`: visibility derived from linked items (must not treat `categoryId == null` as globally visible)

## Required reading (ground truth)
- Spec: `40_features/_cross_cutting/category-scoped-permissions-v2/feature_spec.md`
- Canonical attribution evidence (do not change):
  - `40_features/project-items/flows/inherited_budget_category_rules.md`
  - `40_features/project-transactions/feature_spec.md`
  - `40_features/budget-and-accounting/feature_spec.md`

## Outputs (required)
- Add/modify the **server-side enforcement layer** (Firebase Rules and/or server-side verification mechanism used by the migration) so that:
  - scoped users can only read items per the spec
  - scoped users can only write items per the spec
  - scoped users can only read transactions per the spec (canonical derived visibility included)

## Constraints
- Do not rely on client-side filtering for security.
- Stay compatible with “no large listeners” and delta sync architecture.
- Do not introduce new product capabilities; implement Roles v2 only.

## Notes / edge cases (must be handled explicitly)
- Items:
  - `item.inheritedBudgetCategoryId == null` ⇒ scoped user can read only if `item.createdBy == me`
  - `null → allowedCategoryId` is allowed later
  - `A → B` recategorization is **admin-only**
- Transactions:
  - Canonical `INV_*` have `categoryId == null` by design; do **not** treat as “uncategorized private”
  - Canonical transaction visibility must be derived from linked items the user may read

