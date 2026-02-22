# Issue: "Sell to Project" grayed out for business inventory transaction items

**Status:** Resolved
**Opened:** 2026-02-21
**Resolved:** 2026-02-21

## Info
- **Symptom:** When viewing an item that belongs to a transaction in business inventory, the "Sell to Project" option in the three-dot menu is grayed out.
- **Affected area:** `src/components/items/ItemActionsMenu.tsx`, `src/services/inventoryService.ts`

Investigation revealed three problems:
1. UI disabled "Sell to Project" when item was in business inventory (wrong — that's exactly when you'd want it)
2. `sellItemToProject()` required a `sourceProjectId`, failing for items already in business inventory
3. B.2 scenario handler (`handlePurchaseToDifferentProjectMove`) incorrectly created `INV_SALE_<newProject>` instead of reverting `INV_PURCHASE_<oldProject>` and creating `INV_PURCHASE_<newProject>`

## Experiments

### H1: UI incorrectly disables sell-to-project for business inventory items
- **Rationale:** `isInBusinessInventory` check in `sellToProjectDisabledReason` blocks the action
- **Result:** Confirmed at ItemActionsMenu.tsx line 98
- **Verdict:** Confirmed — removed the check

### H2: Service layer can't handle null sourceProjectId
- **Rationale:** `sellItemToProject()` validates `item.projectId === sourceProjectId` which fails for biz inventory items
- **Result:** Confirmed at inventoryService.ts line 5879
- **Verdict:** Confirmed — made `sourceProjectId` nullable, skip deallocation when null

### H3: B.2 handler creates wrong transaction type
- **Rationale:** `handlePurchaseToDifferentProjectMove` creates `INV_SALE_<newProjectId>` instead of `INV_PURCHASE_<newProjectId>`
- **Result:** Confirmed at inventoryService.ts line 6373
- **Verdict:** Confirmed — rewrote handler to revert Purchase(X) and create Purchase(Y)

## Resolution

- **Root cause:** Three bugs: UI disable logic, missing null sourceProjectId support, wrong B.2 handler
- **Fix:**
  1. Removed `isInBusinessInventory` check from `sellToProjectDisabledReason` in ItemActionsMenu.tsx
  2. Made `sellItemToProject()` accept `sourceProjectId: string | null` — skips deallocation when null
  3. Rewrote `handlePurchaseToDifferentProjectMove` to revert Purchase(X) and create Purchase(Y)
  4. Simplified `itemPullInService` to use unified `sellItemToProject` path
  5. Updated ALLOCATION_TRANSACTION_LOGIC.md with correct B.2 behavior and business context
- **Files changed:**
  - `src/components/items/ItemActionsMenu.tsx`
  - `src/services/inventoryService.ts`
  - `src/services/itemPullInService.ts`
  - `dev_docs/done_implementing/ALLOCATION_TRANSACTION_LOGIC.md`
- **Lessons:** The allocation system has two atomic operations (allocate to project, deallocate to inventory) with a reversion rule (undo existing canonical transaction instead of creating a counter-transaction). B.2 was incorrectly creating a sale for the new project instead of reverting the purchase from the old project and creating a new purchase.
