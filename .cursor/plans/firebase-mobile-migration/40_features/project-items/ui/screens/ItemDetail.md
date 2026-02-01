# Screen contract: Item Detail (shared module; project-scope guardrails)

This contract defines Item Detail behaviors relevant to canonical attribution + `inheritedBudgetCategoryId`.

Shared-module requirement:

- Item Detail UI (including the item actions menu) must be a **shared implementation** reused across Project + Business Inventory scopes, with scope-driven configuration (not duplicated implementations).
- The guardrails in this doc apply when the active scope is **Project** and the user is attempting Project → Business Inventory operations.

Source of truth:

- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

Primary parity evidence (web):

- Item detail screen: `src/pages/ItemDetail.tsx`
- Item actions menu component: `src/components/items/ItemActionsMenu.tsx`
- Item ↔ transaction linking operations: `src/services/inventoryService.ts` (integrationService/unifiedItemsService usage)
- Deallocation path: `integrationService.handleItemDeallocation` invoked from Item Detail (`src/pages/ItemDetail.tsx`)

---

## Display of `inheritedBudgetCategoryId`

### Default: keep implicit (recommended)

In v1 mobile, `inheritedBudgetCategoryId` is an internal determinism field and does not need to be shown as a first-class UI field on Item Detail.

If the field is missing, the UI should surface actionable guidance via disabled actions + an inline banner (below).

Intentional delta:

- This is new for Firebase migration; current web UI does not have this field.

---

## Action restrictions (required)

### 1) Project → Business Inventory guardrail (missing `inheritedBudgetCategoryId`)

If `item.inheritedBudgetCategoryId` is missing, disable:

- **Sell → Sell to Design Business**

Required disable reason:

`Link this item to a categorized transaction before moving it to Design Business Inventory.`

Parity evidence (web action entrypoints):

- Item Detail actions invoke `integrationService.handleItemDeallocation(...)` for “Sell to Design Business” and `integrationService.moveItemToBusinessInventory(...)` for “Move to Design Business” (`src/pages/ItemDetail.tsx`).

Correction path clarification (parity-informed):

- “Move to Design Business” is a correction path and does not create canonical inventory transactions in current web behavior (`moveItemToBusinessInventory` in `src/services/inventoryService.ts`). It may remain enabled even when `inheritedBudgetCategoryId` is missing.

### 2) Attempted operation (race / stale UI)

If an attempt is made despite disablement (e.g. stale cached UI), show:

`Can’t move to Design Business Inventory yet. Link this item to a categorized transaction first.`

---

## Inline messaging (recommended)

When `inheritedBudgetCategoryId` is missing, show a non-blocking banner near the actions area:

- **Title**: `Action required`
- **Body**: `To move this item to Design Business Inventory, first link it to a categorized transaction so the budget category is known.`

---

## Transaction linking rule (required)

When associating/linking an item to a **non-canonical** transaction with a category:

- Set `item.inheritedBudgetCategoryId = transaction.category_id`

When associating/linking to a **canonical inventory** transaction (`INV_*`):

- Do not set or overwrite `item.inheritedBudgetCategoryId`

---

## Notes on canonical attribution (required)

Item Detail does not display canonical transaction category attribution. The system’s budgeting attribution for canonical inventory rows is computed by grouping linked items by `inheritedBudgetCategoryId`.

Intentional delta (vs web):

- The current web app’s budget progress rollups attribute by transaction category and do not perform item-driven grouping for canonical inventory rows (`src/components/ui/BudgetProgress.tsx`).

