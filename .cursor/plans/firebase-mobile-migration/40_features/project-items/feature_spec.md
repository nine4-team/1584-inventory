# Feature spec: Project Items (Firebase mobile migration)

This spec defines **Project Items** behavior for the React Native + Firebase app, with explicit rules for:

- **Canonical inventory transactions** vs **user-facing (non-canonical) transactions**
- **Budget-category attribution** (how budget rollups attribute spend)
- The required item field **`inheritedBudgetCategoryId`** (where it comes from, when it changes, and what breaks if missing)

When current web behavior differs from the desired Firebase policy, it is labeled as an **Intentional delta**.

## Shared module requirement (Project + Business Inventory)

Items must be implemented as a **shared domain module + shared UI primitives** reused across:

- Project workspace context
- Business inventory workspace context

This spec is authored from the project entrypoints, but it is also the **canonical contract** for shared Item components/flows that must be reused in business-inventory scope (with scope-driven configuration, not duplicated implementations).

Source of truth:

- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
  - See also: “Scope config object (contract)” (single config object consumed by shared Items + Transactions UI across project + inventory scopes)

---

## Scope

Project Items includes:

- Project items list (search/filter/sort/group, bulk select + bulk actions)
- Item detail (view/edit, images, transaction association, move/sell flows)
- Item action restrictions and user-facing messaging around cross-scope inventory operations

Out of scope (but referenced):

- Budget rollups UI (project budget screens)
- Business Inventory **workspace shell** screens (tabs/navigation). Item list/detail/actions must still reuse the shared Items module components per the shared-module contract.
- The server-owned multi-entity invariants for allocation/sale/deallocation (see “Architecture constraints”)

---

## Key definitions

### Non-canonical (user-facing) transaction

A normal user-entered transaction where budget category attribution is **transaction-driven**:

- Source-of-truth category selector: `transactions.category_id` (or equivalent in Firebase)

Parity evidence (web):

- Transaction records carry `category_id` and legacy `budget_category` mapping (`src/services/inventoryService.ts`).

### Canonical inventory transaction

A system-generated inventory transaction whose id is one of:

- `INV_PURCHASE_<projectId>`
- `INV_SALE_<projectId>`
- `INV_TRANSFER_*`

These rows exist for inventory correctness (allocation/sale/transfer mechanics) and should not require the user to set a budget category.

Parity evidence (web):

- Canonical transaction id detection: `isCanonicalTransactionId` (`src/services/inventoryService.ts`).
- Canonical sale creation uses `INV_SALE_<projectId>` (`src/services/inventoryService.ts`).

---

## Canonical vs non-canonical budget attribution (required)

### Rule 1 — Non-canonical attribution is transaction-driven

- For **non-canonical** transactions, budget-category attribution comes from `transactions.category_id` (or equivalent).

Source of truth (canonical working doc):

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

### Rule 2 — Canonical inventory attribution is item-driven

- For **canonical inventory transactions** (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`), budget-category attribution is **not** read from the canonical transaction row.
- Instead, attribution is derived by grouping linked items by each item’s `inheritedBudgetCategoryId`.

Implications:

- Canonical inventory transactions should remain **uncategorized from the user’s point of view**.
- Canonical inventory transactions **must not require** a user-facing category selection.

Source of truth (canonical working doc):

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

Intentional delta (vs current web):

- The current web app computes category spend directly from `transaction.categoryId`/`budgetCategory` and treats `INV_SALE_*` as a negative multiplier, without item-driven grouping (`src/components/ui/BudgetProgress.tsx`).
- The current web canonical transaction creation path may assign a default `category_id` and legacy `budget_category` (e.g., “Furnishings”) (`src/services/inventoryService.ts`).

---

## Required item field: `inheritedBudgetCategoryId`

### Field requirements

Every item must persist a stable `inheritedBudgetCategoryId` that:

- Represents the **user-facing budget category** the item “belongs to” for budgeting attribution.
- Is **stable across scope changes** (project ↔ business inventory).
- Is a **direct selector** for downstream systems (e.g., scoping/visibility in roles v2, budget rollups).

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- Compatibility note in feature list: `feature_list.md` calls out `item.inheritedBudgetCategoryId` as a denormalized selector.

### Where it comes from (set rules)

1) **Linking item to a user-facing transaction** sets `item.inheritedBudgetCategoryId`:

- When an item is linked/assigned to a **non-canonical** transaction that has `category_id`, set:
  - `item.inheritedBudgetCategoryId = transaction.category_id`

2) Linking item to a **canonical** inventory transaction must not “invent” attribution:

- Linking to `INV_PURCHASE_*` / `INV_SALE_*` / `INV_TRANSFER_*` must **not** update `item.inheritedBudgetCategoryId`.
  - Canonical rows are system-owned mechanics; attribution remains item-driven and is defined by `inheritedBudgetCategoryId` already on the item.

3) Unlinking from a transaction does **not** clear `item.inheritedBudgetCategoryId`:

- The field is “inherited historically” and should remain stable for deterministic attribution later.

### When it changes (update rules)

Business Inventory → Project allocation/sale is allowed to update the field:

- On BI → Project allocation/sale, the user must choose a **destination project budget category**.
- Persist the selection by setting:
  - `item.inheritedBudgetCategoryId = <chosenCategoryId>`

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

---

## Guardrails (required UI + behavior)

### Guardrail A — Project → Business Inventory requires known `inheritedBudgetCategoryId`

Do not allow “sell/deallocate to Business Inventory” unless the item has previously been linked to a user-facing categorized transaction (so `inheritedBudgetCategoryId` is known/deterministic).

This guardrail applies to all project → business inventory paths that would create/update canonical inventory rows:

- Item actions: “Sell to Design Business”
- Disposition change: setting disposition to `inventory` (deallocation trigger)

This guardrail does **not** apply to “Move to Design Business” when “move” is a pure correction that does not create canonical transactions. In that case, attribution determinism is not required at the moment of the correction (but will be required later for deallocation-like flows).

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

Parity evidence (web paths that must be guarded in Firebase):

- Item detail “sell to business inventory” triggers deallocation: `integrationService.handleItemDeallocation` (`src/pages/ItemDetail.tsx`).
- Project items list disposition → inventory triggers deallocation: `integrationService.handleItemDeallocation` (`src/pages/InventoryList.tsx`).
- “Move to business inventory” exists as a separate correction path that only updates the item’s scope and does not create canonical transactions: `moveItemToBusinessInventory` (`src/services/inventoryService.ts`).

Intentional delta (vs current web):

- The current web UI does not check `inheritedBudgetCategoryId` (field does not exist yet) before allowing these actions.

### Guardrail B — Business Inventory → Project requires category prompt

At BI → Project allocation/sale time, prompt the user to choose a **destination project budget category**.

Defaulting:

- If `item.inheritedBudgetCategoryId` is enabled/available in the destination project, preselect it.
- If no valid default exists, require a selection.

Batch behavior:

- One category choice applies to the whole batch (fast path).

Persistence:

- As part of the operation, set/update `item.inheritedBudgetCategoryId` to the chosen category.

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

Intentional delta (vs current web):

- The current web “sell/move to project” flows prompt only for project selection and do not prompt for a destination budget category (`src/pages/ItemDetail.tsx`, `src/pages/InventoryList.tsx`).

---

## Rollup logic requirement (required; no new UI)

The mobile/Firebase implementation must update **rollup computation** so canonical inventory transactions are attributed by items, not by the canonical transaction’s category.

- UI can remain the same (no new UI required by this spec), but the underlying rollup logic must implement:
  - Non-canonical: `transaction.category_id`
  - Canonical inventory: group linked items by `item.inheritedBudgetCategoryId`

Parity evidence (current web behavior to intentionally change):

- Budget progress uses transaction category fields (not item-grouping) and treats `INV_SALE_*` as negative via a multiplier (`src/components/ui/BudgetProgress.tsx`).

---

## Canonical transaction “category” storage (recommendation)

Goal: canonical inventory transactions should not require a user-facing budget category, and rollups should not attribute from the canonical row’s category.

Recommended approach for Firebase:

- **Preferred**: keep `transaction.category_id = null` for canonical inventory transactions; treat them as “uncategorized” in UI.
- **If a category field must exist for schema compatibility**: allow a hidden/internal account category (e.g., “Canonical (system)”) but enforce:
  - rollups ignore canonical transaction category, using item-driven attribution instead.

Note (web parity context):

- Current web code may assign a default `category_id` and a legacy `budget_category` string on canonical rows (`src/services/inventoryService.ts`). This is acceptable to preserve as an internal implementation detail only if it does not drive attribution.

---

## Architecture constraints (must hold)

All Firebase/RN implementations must follow:

- Offline-first invariants and delta sync + change-signal plan: `40_features/sync_engine_spec.plan.md`
- Multi-entity correctness must be enforced as **server-owned invariants** for allocation/sale/deallocation (Callable Function / Firestore transaction), not UI-only.

Implications for this spec:

- `inheritedBudgetCategoryId` must be a first-class field in the **item document** and local SQLite schema.
- Cross-scope operations that set/update `inheritedBudgetCategoryId` must be atomic with the scope move so retries are safe and deterministic.

