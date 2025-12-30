# Allocation System Refactor (No Migration)

## Executive Summary

Today the app duplicates items across two separate collections:
- `projects/{projectId}/items` (per‑project duplicates)
- `business_inventory` (business stock)

This causes data drift and complex flows. We will refactor to a single top‑level `items` collection as the source of truth. Project assignment is tracked by `project_id`; availability is tracked by `inventory_status`. No migration/backwards compatibility is required — we will change the code to point at the new `items` collection and delete duplication logic.

Additionally, we will enforce at most two canonical transactions per project related to inventory movement:
- One singleton "inventory sale to client" transaction (client owes)
- One singleton "inventory buy‑from‑client" transaction (we owe)
All other vendor/store/fuel transactions remain many‑per‑project and are unchanged.

## What the code does today (verified)

- Project items are queried from a project subcollection:
```12:18:src/services/inventoryService.ts
export const itemService = {
  // Get items for a project with filtering and pagination
  async getItems(
    projectId: string,
    filters?: FilterOptions,
    pagination?: PaginationOptions
  ): Promise<Item[]> {
    const itemsRef = collection(db, 'projects', projectId, 'items')
```

- Business inventory is queried/written in `business_inventory`:
```971:978:src/services/inventoryService.ts
const itemsRef = collection(db, 'business_inventory')
let q = query(itemsRef)
```

- Batch allocation creates duplicate project items and marks business items as sold:
```1281:1315:src/services/inventoryService.ts
// Create project items from business inventory items
const projectItemRef = doc(db, 'projects', projectId, 'items', projectItemId)
...
batch.set(projectItemRef, projectItemData)
...
const itemRef = doc(db, 'business_inventory', itemId)
batch.update(itemRef, {
  inventory_status: 'sold',
  current_project_id: projectId,
  pending_transaction_id: transactionRef.id,
})
```

- Single allocation creates a project transaction and updates only the business inventory item:
```1210:1232:src/services/inventoryService.ts
const transactionsRef = collection(db, 'projects', projectId, 'transactions')
const transactionRef = await addDoc(transactionsRef, transactionData)
...
await this.updateBusinessInventoryItem(itemId, {
  inventory_status: 'pending',
  current_project_id: projectId,
  pending_transaction_id: transactionRef.id
})
```

- Transaction item lookup reads project subcollection items by `transaction_id`:
```640:645:src/services/inventoryService.ts
const itemsRef = collection(db, 'projects', projectId, 'items')
const q = query(
  itemsRef,
  where('transaction_id', '==', transactionId),
  orderBy('date_created', 'asc')
)
```

- Types already include fields needed for unified items (note: both exist today):
```60:88:src/types/index.ts
export interface Item {
  ...
  transaction_id: string;
  project_id: string; // currently required
  ...
  inventory_status?: 'available' | 'pending' | 'sold';
  current_project_id?: string; // duplicate concept; to be removed
}
```

## Target Architecture (single source of truth)

- Collection: `items` (top‑level)
- Example item document fields:
  - `item_id: string` (document id)
  - `project_id?: string | null` (null ⇒ business inventory; `projectId` ⇒ allocated)
  - `inventory_status: 'available' | 'pending' | 'sold'`
  - `pending_transaction_id?: string` (set while allocation is pending)
  - existing fields: `description`, `project_price`, `market_value`, `images`, etc.

- Project “inventory” view = `items` WHERE `project_id == projectId`.
- Business inventory view = `items` WHERE `project_id == null`.
- Transactions store which items are involved via `item_ids: string[]`.

## Singleton transactions per project

We will maintain up to two canonical transactions per project that represent inventory movement:
- Inventory sale to client (items allocated to project): reimbursement_type = 'Client Owes'
- Inventory buy‑from‑client (items returned to business inventory): reimbursement_type = 'We Owe'

Canonical IDs (deterministic):
- Sale: `INV_SALE_<projectId>`
- Buy: `INV_BUY_<projectId>`

Implementation rules:
- Upsert by ID: `setDoc(doc(projects/<id>/transactions/<CANONICAL_ID>), data, { merge: true })`.
- Maintain `item_ids` on the transaction via `arrayUnion(itemId)` and `arrayRemove(itemId)` when needed.
- Compute `amount` as the sum of linked items:
  - Sale: sum of `project_price` for all `item_ids`.
  - Buy: sum of `purchase_price` (or chosen field) for all `item_ids`.
- Status:
  - `pending` while any linked item is pending/unpaid.
  - `completed` when payment is recorded.
- Concurrency:
  - Use Firestore transactions for amount recompute. Use `arrayUnion/arrayRemove` for item_ids updates, then re‑read to recompute.
- Other transactions (stores, gas, vendors) remain normal many‑per‑project docs.

## Refactor Plan (no migration, no backward compatibility)
Make the following code edits. You can keep everything inside `src/services/inventoryService.ts` for now to minimize churn, then optionally split later.

### 1) Types
- In `src/types/index.ts`:
  - Make `Item.project_id` nullable: `project_id?: string | null`.
  - Remove `Item.current_project_id` everywhere in code and types.
  - Replace `BusinessInventoryItem` usages with `Item` and remove `BusinessInventoryItem` interface after refactor.
  - Extend `Transaction` to link items:
    - Add `item_ids?: string[]` (batch and single use this uniformly).

### 2) New item repository API (top‑level `items`)
Implement these functions (either in a new `itemsService` or within `inventoryService.ts`). All use `collection(db, 'items')`:
- `getItemsByProject(projectId: string): Promise<Item[]>`
  - Query: `where('project_id', '==', projectId')`, order by `last_updated` desc.
- `subscribeToItemsByProject(projectId: string, cb: (items: Item[]) => void)`
- `getBusinessInventoryItems(filters?): Promise<Item[]>`
  - Query: `where('project_id', '==', null)` + optional `inventory_status` and text filter.
- `subscribeToBusinessInventory(cb, filters?)`
- `createItem(data: Omit<Item, 'item_id'|'date_created'|'last_updated'>): Promise<string>`
- `updateItem(itemId: string, updates: Partial<Item>): Promise<void>`
- `deleteItem(itemId: string): Promise<void>`

### 3) Allocation and sale flows (no duplicates)
Replace the existing allocation/deallocation/batch logic with singleton transactions:
- `allocateItemToProject(itemId, projectId, amount?, notes?)`:
  - Upsert `projects/{projectId}/transactions/INV_SALE_<projectId>` with `status: 'pending'`, `trigger_event: 'Inventory allocation'`, `reimbursement_type = 'Client Owes'` and `arrayUnion(itemId)`. Recompute `amount` from current items.
  - Update the item (top‑level `items/{itemId}`):
    - `project_id = projectId`
    - `inventory_status = 'pending'`
    - `pending_transaction_id = 'INV_SALE_<projectId>'`
- `batchAllocateItemsToProject(itemIds[], projectId, { notes?, space? })`:
  - Upsert the same `INV_SALE_<projectId>` transaction with all ids via `arrayUnion(...itemIds)` and recompute `amount`.
  - For each `itemId`, update top‑level item as above; do NOT write to `projects/{projectId}/items`.
- `returnItemFromProject(itemId, projectId, amount?, notes?)` (buy‑from‑client):
  - Upsert `projects/{projectId}/transactions/INV_BUY_<projectId>` with `status: 'pending'`, `trigger_event: 'Inventory return'`, `reimbursement_type = 'We Owe'`, `arrayUnion(itemId)`. Recompute `amount` from items.
  - Update item: `inventory_status = 'available'`, `pending_transaction_id = 'INV_BUY_<projectId>'`, `project_id = null`.
- `completePendingTransaction(transactionType: 'sale'|'buy', projectId, paymentMethod)`:
  - Mark the canonical transaction as `status: 'completed'`, set `payment_method`.
  - For all linked items, clear `pending_transaction_id`; for sale, optionally keep `project_id` as the sold project or set to null per your UX.

Implement a helper: `getItemsForTransaction(projectId, transactionId)` that queries top‑level `items` where `(pending_transaction_id == transactionId)` and optionally `project_id == projectId`. For completed sales, you may also link via an optional `last_transaction_id` field on items if you want historical lookups without pending links.

### 4) Replace old per‑collection code paths
Remove usage of:
- `collection(db, 'projects', projectId, 'items')`
- `collection(db, 'business_inventory')`

Update callers to use the new top‑level items API. Files to edit:
- `src/pages/InventoryList.tsx`
  - Replace `itemService.getItems(projectId)` with `getItemsByProject(projectId)`.
  - Replace `itemService.subscribeToItems(projectId, cb)` with `subscribeToItemsByProject(projectId, cb)`.
- `src/pages/BusinessInventory.tsx`
  - Replace all `businessInventoryService.*` calls with top‑level `items` equivalents (get/subscribe/create/update/delete/duplicate if needed).
  - Update batch allocation to call `batchAllocateItemsToProject` from the new flow (no duplicates).
- `src/pages/BusinessInventoryItemDetail.tsx`
  - Replace `businessInventoryService.allocateItemToProject` with the new singleton‑aware `allocateItemToProject` (top‑level `items`).
  - Replace `deleteBusinessInventoryItem/updateBusinessInventoryItem` with `deleteItem/updateItem` on `items`.
- `src/pages/TransactionDetail.tsx`, `src/pages/AddTransaction.tsx`, `src/pages/EditTransaction.tsx`
  - Change any calls to `itemService.getTransactionItems(projectId, transactionId)` to use the new `getItemsForTransaction(projectId, transactionId)` against top‑level `items`.

### 5) Transactions shape
- Use canonical IDs `INV_SALE_<projectId>` / `INV_BUY_<projectId>` for inventory movement.
- Maintain `item_ids` via `arrayUnion/arrayRemove` and recompute `amount` from linked items.
- For “sale complete” / “buy complete”, set `status: 'completed'` and clear `pending_transaction_id` on items.

### 6) Clean up types and dead code
- Remove `BusinessInventoryItem` interface and all imports/usages after callers are updated.
- Remove `current_project_id` field everywhere; standardize on `project_id?: string | null`.
- Remove/deprecate the old per‑project items API and any UI code that depends on it.

### 7) Firestore security rules
- Open `firestore.rules` and grant appropriate read/write access to the top‑level `items` collection as your app requires.
- Allow `arrayUnion/arrayRemove` updates on canonical transaction docs; validate `amount` server‑side if you add Cloud Functions.
- Remove references that assumed `projects/*/items` and `business_inventory`.

## Acceptance checklist
- All item queries read from top‑level `items` only.
- Project views filter by `project_id`.
- Business inventory view filters by `project_id == null`.
- Allocation/return flows update canonical transactions `INV_SALE_<projectId>` / `INV_BUY_<projectId>`.
- Transaction `item_ids` maintained via `arrayUnion/arrayRemove`; `amount` reflects sum of linked items.
- Items updated without duplication; `pending_transaction_id` points at the appropriate canonical transaction while pending.
- Transaction detail pages show items by querying top‑level `items` for the canonical transaction ID.
- No references to `projects/{projectId}/items` or `business_inventory` remain.

## Notes for the implementer (why this is safe now)
- Verified current duplication and wrong-collection usage:
```116:121:src/services/inventoryService.ts
const itemsRef = collection(db, 'projects', projectId, 'items')
```
```1251:1260:src/services/inventoryService.ts
const businessItemsRef = collection(db, 'business_inventory')
```
- Verified `Item` currently has both `project_id` and `current_project_id`; this refactor removes the latter and makes `project_id` nullable.

## Additional cleanup recommendations
- Standardize on a single cost field naming: prefer `purchase_price`; eliminate duplicate `price` where possible.
- If you no longer need `item.transaction_id` on the item document, replace it with `last_transaction_id` (optional) and rely on `Transaction.item_ids` for linkage.
- Ensure QR key generation (`qr_key`) is consistent in allocation and creation flows.
- Remove any references to per‑project item images handling that assume subcollections; images should live on the top‑level item document.

## Fix-It Section: Inventory Disposition Transaction Creation Issue

### Problem Identified
When changing a project item's disposition to "Inventory", the item is successfully moved from project inventory to business inventory, but no "We Owe" transaction is created.

### Root Cause
The deallocation logic has two different code paths:
1. `handleExistingTransactionCase` - for items that already have a `transaction_id`
2. `handleDirectInventoryDesignation` - for items without a `transaction_id`

The issue occurs in the first path. When an item has an existing `transaction_id`, the system tries to handle it as an "existing allocation scenario" but the transaction creation logic is not working properly.

### Symptoms
- Item disposition changes to "inventory" ✅
- Item is removed from project inventory ✅
- Item appears in business inventory ✅
- No "We Owe" transaction is created ❌
- No transaction creation logs appear in console ❌

### Current Behavior vs Expected Behavior

**Current (Broken):**
```
🔗 Item has existing transaction_id: FqjicC4ujbjJtGja3S9E
[NO TRANSACTION CREATION LOGS]
✅ Deallocation completed successfully
```

**Expected (Working):**
```
🔗 Item has existing transaction_id: FqjicC4ujbjJtGja3S9E
🏦 Creating purchase transaction for item: I-1759785782780-puce
🔑 Canonical transaction ID: INV_BUY_T9uGIa7QkgnhKcBOclRd
💾 Creating transaction document...
✅ Transaction created successfully
📦 Updating item to move to business inventory...
✅ Item updated successfully
✅ Deallocation completed successfully
```

### Recommended Fix
The deallocation logic should be simplified to always create/update a "We Owe" transaction when disposition is set to "inventory", regardless of existing transaction state. The complex logic for handling existing transactions is causing the transaction creation to fail silently.

**Key Issue: Canonical Transaction Already Exists**
When the canonical `INV_BUY_<projectId>` transaction already exists (from previous deallocations), the current logic may not properly:
1. Add the new item to the existing transaction's `item_ids` array
2. Update the transaction amount to include the new item's value
3. Maintain the existing transaction data while adding the new item

**Suggested Code Changes:**
1. Remove the `handleExistingTransactionCase` vs `handleDirectInventoryDesignation` branching logic
2. Always call a unified `ensurePurchaseTransaction` function when disposition is "inventory"
3. This function should:
   - Check if `INV_BUY_<projectId>` transaction exists
   - If it exists: add the item to `item_ids` array and recalculate amount
   - If it doesn't exist: create new transaction with the item
   - Use `setDoc` with `merge: true` to handle both cases
4. Add proper error handling and logging throughout the transaction creation process

**Implementation Details:**
- Use `arrayUnion(itemId)` to add items to the `item_ids` array without duplicates
- For amount calculation: sum `purchase_price` for all items in `item_ids` (fallback to `market_value` if `purchase_price` is missing), rounded to 2 decimal places
- Perform amount recompute atomically after `arrayUnion` to avoid race conditions
- Use `pending_transaction_id` field on items during the allocation/deallocation process (as referenced in line 59 of this document)
- For historical linkage, consider adding an optional `last_transaction_id` field to items after transaction completion

### Testing Steps
1. Change a project item's disposition to "Inventory"
2. Verify console shows transaction creation logs
3. Check that a new transaction with ID `INV_BUY_<projectId>` is created in the database
4. Verify the transaction has `reimbursement_type: 'We Owe'` and `item_ids` array
5. Confirm the item is properly linked to the new transaction

**Additional Test Cases:**
6. **Existing Transaction Scenario**: Change multiple items' disposition to "Inventory" over time
7. **Verify Existing Transaction Updates**: Check that subsequent items are added to the same `INV_BUY_<projectId>` transaction's `item_ids` array
8. **Amount Recalculation**: Confirm the transaction `amount` increases correctly when new items are added
9. **Legacy Transaction Handling**: Verify items with non-canonical `transaction_id` values still create/update the canonical `INV_BUY_<projectId>` transaction
