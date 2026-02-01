# Prompt Pack — Chat B: Delta sync scoping + local DB invariants (Roles v2)

## Goal
Implement Roles v2 scoping in the **delta sync layer** so the device’s SQLite DB stores **only what the user is allowed to read** (preferred approach in the spec).

This must remain compatible with:
- offline-first (SQLite source of truth)
- outbox + idempotency
- change-signal + delta sync
- no “subscribe to everything”

## Required reading (ground truth)
- Spec: `40_features/_cross_cutting/category-scoped-permissions-v2/feature_spec.md` (see §4.3 decision)
- Canonical attribution evidence (do not change):
  - `40_features/project-items/flows/inherited_budget_category_rules.md`
  - `40_features/project-transactions/feature_spec.md`
  - `40_features/budget-and-accounting/feature_spec.md`

## Outputs (required)
- Update the sync query strategy so that:
  - items synced are only those visible under Roles v2 rules
  - non-canonical transactions synced are only those visible under Roles v2 rules
  - canonical `INV_*` transaction syncing respects derived visibility (only sync canonical rows that have at least one in-scope linked item)
- Define behavior for scope changes:
  - when `allowedCategoryIds` expands: backfill newly-visible rows
  - when `allowedCategoryIds` shrinks: prune (or mark hidden) rows that are no longer visible (preferred: prune)

## Constraints
- No client-side filtering after downloading unauthorized rows.
- No large listeners on collections.
- Do not introduce new product capabilities; implement Roles v2 only.

## Edge cases that must be explicit
- “Uncategorized item” rule is item-specific (`item.inheritedBudgetCategoryId == null`), not transaction-specific.
- Canonical transactions have `categoryId == null` by design; do not treat them as globally visible.

