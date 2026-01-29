## Goal
Ship Roles v2 **category-scoped access control** in a way that:

- is enforced server-side (Firebase Rules / server-side enforcement is source of truth)
- stays compatible with the migration architecture: **offline-first**, SQLite source of truth, **outbox**, **delta sync**, **change-signal** (no “subscribe to everything”)
- preserves canonical attribution semantics for inventory transactions:
  - canonical `INV_*` transactions keep `transaction.categoryId = null`
  - canonical visibility and filtering are **item-driven** via `item.inheritedBudgetCategoryId`

Spec source of truth:
- `40_features/_cross_cutting/category-scoped-permissions-v2/feature_spec.md`

Canonical attribution evidence sources (must remain consistent):
- `40_features/project-items/flows/inherited_budget_category_rules.md`
- `40_features/project-transactions/feature_spec.md`
- `40_features/budget-and-accounting/feature_spec.md`

## Primary risk (what can go wrong)
- Accidentally treating canonical `INV_*` transactions with `categoryId == null` as “globally visible uncategorized”.
- Client-side filtering after downloading unauthorized rows (violates the security model and the “no subscribe to everything” constraint).
- Offline DB containing out-of-scope rows (privacy + confusing UX).

## Output files (this work order will produce)
Minimum:
- `40_features/_cross_cutting/category-scoped-permissions-v2/feature_spec.md` (already exists)
- `40_features/_cross_cutting/category-scoped-permissions-v2/plan.md` (this file)
- `40_features/_cross_cutting/category-scoped-permissions-v2/prompt_packs/` (Chats A–D)

Optional (if needed by implementation complexity):
- `40_features/_cross_cutting/category-scoped-permissions-v2/acceptance_criteria.md`

## Implementation phases (2–4 slices)

### Phase A — Data shape + server-side gates (entitlements + write rules)
**Goal**: establish the membership entitlement shape and hard server-side allow/deny behavior for:
- item reads/writes (including “own uncategorized” exception)
- non-canonical transaction reads
- canonical transaction reads (derived-from-linked-items rule)

**Exit criteria**
- There is a single, explicit entitlement representation per member (admin flag + category set/map).
- All key allow/deny rules from the spec are enforceable without relying on UI.

### Phase B — Delta sync scoping + local DB invariants
**Goal**: make sure SQLite contains **only** rows the user can read, by applying scope filters in delta sync.

**Exit criteria**
- Items and non-canonical transactions are queried with scope constraints (no “fetch everything then filter”).
- Canonical `INV_*` transaction fetching respects derived visibility (implementation-specific strategy permitted, but must meet constraints).
- Documented behavior when `allowedCategoryIds` changes (backfill + optional prune).

### Phase C — UI gating + canonical Transaction Detail redaction
**Goal**: ensure consistent UX:
- category pickers/filters show only allowed categories
- canonical transaction detail shows only in-scope linked items

**Exit criteria**
- No UI shows out-of-scope categories.
- Canonical Transaction Detail never leaks out-of-scope items.

### Phase D — Hardening (tests + edge-case audit)
**Goal**: reduce regression risk and validate invariants.

**Exit criteria**
- Tests cover the core read/write matrix (admin vs scoped, null vs non-null item category, canonical vs non-canonical transaction).
- Tests cover the canonical rule: visibility derives from linked items, not `transaction.categoryId`.

## Prompt packs (copy/paste)
Create `prompt_packs/` with one chat per phase:
- Chat A: server-side rules + membership entitlement shape
- Chat B: delta sync scoping + local DB storage invariants
- Chat C: UI gating + canonical Transaction Detail redaction behavior
- Chat D: tests + edge-case audit

