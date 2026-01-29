# Screen contract: Project Items List

This contract defines **project-scope** Items list behaviors relevant to canonical attribution + `inheritedBudgetCategoryId` guardrails.

Shared-module requirement:

- The Items list UI (including per-row actions menus and bulk controls) must be a **shared implementation** reused across Project + Business Inventory scopes, with scope-driven configuration (not duplicated implementations).
- The guardrails in this doc apply when the active scope is **Project** and the user is attempting Project → Business Inventory operations.

Source of truth:

- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

Primary parity evidence (web):

- Project list page: `src/pages/InventoryList.tsx`
- Per-item actions menu: `src/components/items/ItemActionsMenu.tsx`
- Bulk actions surface: `src/components/ui/BulkItemControls.tsx`
- Disposition → inventory triggers deallocation: `src/pages/InventoryList.tsx` (calls `integrationService.handleItemDeallocation`)

---

## Core list behaviors (non-exhaustive)

List UI (search/filter/sort/group, selection, bulk actions) should match existing parity patterns. This doc focuses only on behaviors impacted by the canonical attribution rules.

---

## Item action restrictions (required)

### 1) Project → Business Inventory guardrail (missing `inheritedBudgetCategoryId`)

If an item’s `inheritedBudgetCategoryId` is missing, the row actions menu must disable:

- **Sell → Sell to Design Business**

Required disable reason (tooltip/help text):

`Link this item to a categorized transaction before moving it to Design Business Inventory.`

Notes:

- “Categorized transaction” means a non-canonical transaction with a category.
- This is an **intentional Firebase-migration delta**; current web code does not check this field (field does not exist yet).
- “Move to Design Business” is a correction path and does not create canonical transactions in current web behavior (`moveItemToBusinessInventory` in `src/services/inventoryService.ts`). It may remain enabled even when `inheritedBudgetCategoryId` is missing.

---

## Disposition changes (required)

### 2) Disposition → `inventory` triggers deallocation (and must apply the guardrail)

When disposition is set to `inventory`, the system triggers deallocation (project → business inventory).

Parity evidence (web):

- `InventoryList` calls `integrationService.handleItemDeallocation(...)` when disposition becomes `inventory` (`src/pages/InventoryList.tsx`).

Required Firebase-migration policy:

- If `inheritedBudgetCategoryId` is missing, block changing disposition to `inventory` and show:

**Error toast**:

`Can’t move to Design Business Inventory yet. Link this item to a categorized transaction first.`

And keep the prior disposition (no optimistic flip that later reverts).

---

## Bulk actions (required)

### 3) Bulk “Set Disposition” → `inventory`

If the user bulk-sets disposition to `inventory`, apply the same guardrail:

- If any selected item is missing `inheritedBudgetCategoryId`, the bulk operation must not proceed.
- Show the same error toast as the single-item flow.

Parity evidence (web):

- Bulk controls exist and include “Set Disposition” (`src/components/ui/BulkItemControls.tsx`), and `InventoryList` bulk disposition handler triggers deallocation for `inventory` (`src/pages/InventoryList.tsx`).

Intentional delta (vs web):

- Current web implementation does not have the `inheritedBudgetCategoryId` field and thus cannot enforce the guardrail.

### 4) Bulk move/sell (future surface)

If/when the Project Items list adds bulk “Move/Sell to Business Inventory” actions, they must:

- Be disabled when any selected item is missing `inheritedBudgetCategoryId`
- Use the same disable reason + error toast copy

