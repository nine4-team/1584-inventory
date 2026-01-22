# Offline Item Controls Runtime Verification Plan

## Goal
Provide a **runtime, end-to-end** verification that each item menu control behaves correctly while offline and then synchronizes when back online. This goes beyond code inspection by validating **observed behavior** in the UI and data.

## Context for the Next Model

### Key UI Surfaces (where the item menu appears)
- Project inventory list: `src/pages/InventoryList.tsx` → `InventoryItemRow` → `ItemPreviewCard` → `ItemActionsMenu`
- Business inventory list: `src/pages/BusinessInventory.tsx` → `InventoryItemRow` → `ItemPreviewCard` → `ItemActionsMenu`
- Transaction item list: `src/components/TransactionItemsList.tsx` → `ItemPreviewCard` → `ItemActionsMenu`
- Item detail (project + BI routes): `src/pages/ItemDetail.tsx` → `ItemActionsMenu`
- Business inventory item detail: `src/pages/BusinessInventoryItemDetail.tsx` → `ItemActionsMenu`

### Offline-Aware Service Entrypoints
- Assign to transaction: `unifiedItemsService.assignItemToTransaction`
- Duplicate: `unifiedItemsService.duplicateItem` (via `useDuplication`)
- Sell to project: `unifiedItemsService.sellItemToProject`
- Sell to business: `integrationService.handleItemDeallocation`
- Move to business: `integrationService.moveItemToBusinessInventory` → `unifiedItemsService.updateItem`
- Move to project (BI): `unifiedItemsService.allocateItemToProject`
- Edit / Change status: `unifiedItemsService.updateItem`
- Delete: `unifiedItemsService.deleteItem`

### Known Offline Queue Paths
These operations enqueue work when `isNetworkOnline()` is false:
- `enqueueSellItemToProject`, `enqueueAllocateItemToProject`, `enqueueDeallocateItemToBusinessInventory`
- `offlineItemService.updateItem`, `offlineItemService.deleteItem`
- `markTransactionItemIdsPendingAction` / `markTransactionItemIdsPending`

### Known Exception
Bulk assign-to-transaction is still gated offline:
- `InventoryList.tsx` → `BulkItemControls` → `enableAssignToTransaction={isOnline}`
- This does **not** affect per-item menu actions.

## Pre-Flight Checklist
- App runs locally with a test account.
- Access to a test project and business inventory.
- A project item that is:
  - persisted (real UUID)
  - not tied to a non-canonical transaction
  - has at least one image and some fields filled in (price, SKU) for visibility.
- A business inventory item that is persisted.
- At least one existing transaction in the project and one BI transaction.
- Ensure offline mode can be simulated (Chrome DevTools > Network > Offline).

## Test Data Setup (If Missing)
1. Create a project item with a distinctive description.
2. Create a BI item with a different description.
3. Create a project transaction with a known amount.
4. Create a BI transaction with a known amount.
5. Attach one item to a transaction while online to validate later unlink/change behavior.

## Runtime Verification Steps (Offline First)

### Step A: Toggle Offline
- Open DevTools, set Network to **Offline**.
- Confirm UI indicates offline (if any UI signal exists).

### Step B: Per-Action Tests (Offline)
Run each test in **each relevant surface** (project list, BI list, item detail, BI item detail, transaction list if applicable).

#### 1) Add To Transaction…
- Action: assign an item to a transaction.
- Expected offline result:
  - Item shows transaction assignment locally.
  - No crash or blocking error.
  - When back online, assignment persists and transaction’s `item_ids` list updates.

#### 2) Make Copies…
- Action: duplicate an item with quantity > 1.
- Expected offline result:
  - New items appear locally.
  - If original was tied to a transaction, newly created items appear tied to it.
  - When back online, items persist and no integrity errors.

#### 3) Sell To Design Business
- Action: move project item to business inventory via Sell submenu.
- Expected offline result:
  - Item appears in BI or shows pending status consistent with existing offline UI patterns.
  - When online, sale/deallocation completes and lineage updated (no phantom item).

#### 4) Sell To Project…
- Action: sell project item to a different project.
- Expected offline result:
  - Operation queues without error.
  - When online, item ends up in target project with correct transaction linkage (purchase/sale).

#### 5) Move To Design Business
- Action: move project item to BI without sale.
- Expected offline result:
  - Item moves locally (project → BI).
  - When online, state persists and item’s projectId is null.

#### 6) Move To Project…
- BI item: allocate to project.
- Project item: simple move between projects (if applicable).
- Expected offline result:
  - Item appears in target project (or pending allocation state).
  - When online, allocation transaction is created and item remains in target project.

#### 7) Change Status
- Action: set each status option (To Purchase / Purchased / To Return / Returned).
- Expected offline result:
  - Status reflects locally.
  - When online, status persists.

#### 8) Delete…
- Action: delete item.
- Expected offline result:
  - Item disappears locally.
  - When online, item remains deleted.

#### 9) Edit
- Action: navigate to edit screen, update fields, save.
- Expected offline result:
  - Edits are reflected locally.
  - When online, updates persist.

### Step C: Toggle Online
- Disable offline mode.
- Validate all previously queued changes resolve correctly.

## Observability and Diagnostics
- Monitor console logs for offline queue messages or errors.
- If possible, inspect local offline storage (IndexedDB) for queued operations.
- Confirm no unexpected reverts after re-sync.

## Reporting Requirements
For each action, record:
- Context (where it was tested)
- Expected vs observed behavior
- Any console errors (copy snippets)
- Any mismatch between local and synced state

## Deliverable
Update `dev_docs/actively_implementing/OFFLINE_ITEM_CONTROLS_VERIFICATION.md` with:
- A **runtime test matrix** (action × surface)
- Outcomes and any discrepancies
- Notes on known limitations or non-blocking issues
