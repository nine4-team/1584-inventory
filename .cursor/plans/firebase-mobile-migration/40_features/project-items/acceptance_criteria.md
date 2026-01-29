# Acceptance criteria: Project Items — canonical attribution + `inheritedBudgetCategoryId`

These criteria are written so a dev can implement the rules without reading the working doc.

All items below are **required** unless explicitly marked as optional.

Shared-module requirement:

- The Items list/detail/actions/bulk-controls components must be implemented as a **shared Items module** reused across Project + Business Inventory scopes (scope-driven configuration; no duplicated implementations).
- Source of truth: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

---

## A) Canonical vs non-canonical attribution rules

- **A1 (non-canonical)**: For non-canonical (user-facing) transactions, budget attribution uses `transaction.category_id` (or equivalent).
- **A2 (canonical inventory)**: For canonical inventory transactions (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`), budget attribution is **item-driven**:
  - Group linked items by `item.inheritedBudgetCategoryId`
  - Attribute amounts to each category group using the canonical item value rules for that flow
- **A3 (no user-facing canonical category)**: Canonical inventory transactions must not require a user-facing category selection. Canonical rows may have `category_id = null` and must be treated as uncategorized for user-driven attribution.

Evidence / deltas:

- **Intentional delta** vs current web: budget rollups currently use `transaction.categoryId` / legacy `budgetCategory` and do not group canonical rows by item category (`src/components/ui/BudgetProgress.tsx`).

---

## B) Item field: `inheritedBudgetCategoryId`

- **B1 (field exists)**: Every item record includes `inheritedBudgetCategoryId` (nullable), persisted in local DB and synced remotely.
- **B2 (stable across scope moves)**: When an item moves between project ↔ business inventory, `inheritedBudgetCategoryId` is preserved unless explicitly updated by a rule below.
- **B3 (set on user-facing link)**: When linking an item to a **non-canonical** transaction with a non-null `category_id`, set:
  - `item.inheritedBudgetCategoryId = transaction.category_id`
- **B4 (do not set from canonical link)**: Linking/unlinking an item to/from a canonical inventory transaction (`INV_*`) must **not** set or overwrite `item.inheritedBudgetCategoryId`.
- **B5 (do not clear on unlink)**: Unlinking an item from a transaction must not clear `item.inheritedBudgetCategoryId`.

---

## C) Guardrail: Project → Business Inventory requires known category

### C1 — UI gating (actions menu + bulk + disposition)

If an item’s `inheritedBudgetCategoryId` is missing (null/empty), the UI must disable the project → business inventory actions that would create/update canonical inventory rows.

At minimum, disable:

- “Sell to Design Business”
- Any “Deallocate to inventory” path (including changing disposition to `inventory`)

Explicitly allowed:

- “Move to Design Business” (correction path) may remain available even when `inheritedBudgetCategoryId` is missing, because it does not create canonical inventory transactions in current parity behavior (`moveItemToBusinessInventory` is a direct item scope update in `src/services/inventoryService.ts`).

### C2 — User-facing messaging (copy is required)

When disabled (e.g., tooltip/help text), use:

- **Disable reason**: `Link this item to a categorized transaction before moving it to Design Business Inventory.`

If the user attempts the operation anyway (race condition / deep-link / stale UI), show:

- **Error toast**: `Can’t move to Design Business Inventory yet. Link this item to a categorized transaction first.`

Notes:

- “Categorized transaction” refers to a **non-canonical** transaction with a category.

Evidence / deltas:

- **Intentional delta** vs current web: current UI allows these actions without `inheritedBudgetCategoryId` gating because the field doesn’t exist (`src/components/items/ItemActionsMenu.tsx`, `src/pages/ItemDetail.tsx`, `src/pages/InventoryList.tsx`).

---

## D) BI → Project prompt (destination project budget category)

### D1 — Prompt requirement

When allocating/selling from Business Inventory to a Project, prompt the user to choose a destination **project budget category**.

### D2 — Defaulting rules

- If `item.inheritedBudgetCategoryId` exists and is enabled/available in the destination project, preselect it.
- Otherwise, require an explicit selection (no implicit fallback).

### D3 — Batch rule (fast path)

If the operation is applied to a batch of items, one selected category applies to the whole batch.

### D4 — Persistence requirement

On success, persist the choice back onto the item(s):

- `item.inheritedBudgetCategoryId = <chosenDestinationCategoryId>`

Evidence / deltas:

- **Intentional delta** vs current web: current “sell/move to project” dialogs prompt only for project selection, no category prompt (`src/pages/ItemDetail.tsx`, `src/pages/InventoryList.tsx`).

---

## E) Rollup logic update (required; no new UI)

- **E1**: Budget rollups must implement canonical item-driven attribution:
  - Non-canonical: attribute by `transaction.category_id`
  - Canonical inventory: attribute by grouping linked items by `item.inheritedBudgetCategoryId`
- **E2**: Rollups must not attribute canonical inventory transactions based on `transaction.category_id` (even if present for internal compatibility).

Parity evidence (intentional change):

- Current web rollups use transaction category fields and a negative multiplier for `INV_SALE_*` (`src/components/ui/BudgetProgress.tsx`).

