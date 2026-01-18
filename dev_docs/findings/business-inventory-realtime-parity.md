# Business Inventory Realtime Parity Audit and Fix Plan

## Goal
Ensure business inventory UI updates in real time with the same reliability and scope as project inventory (items and transactions). This includes CRUD updates, offline sync reconciliation, and post-reconnect refresh behavior.

## Scope
- Project realtime baseline: `ProjectRealtimeContext`, `InventoryList`, `ItemDetail`, and supporting services in `inventoryService.ts`.
- Business inventory: `BusinessInventory`, `BusinessInventoryItemDetail`, and `unifiedItemsService.subscribeToBusinessInventory` plus `transactionService.subscribeToAllTransactions`.

## What Is Aligned Today
- Both areas rely on Supabase realtime subscriptions for items.
- Both use `unifiedItemsService` and `transactionService` for CRUD operations.
- Both listen for lineage edges and refetch items when lineage changes.
- Both use the duplication hook to create new items and expect realtime updates to backfill UI state.

## Gaps and Impact
1. Business inventory transactions subscription pulls all account transactions.
   - Location: `BusinessInventory` uses `transactionService.subscribeToAllTransactions`.
   - Impact: after any realtime event, the transactions list can include unrelated project transactions, diverging from the initial filtered query (business inventory + inventory-related).
2. Business inventory item subscription has no shared cache or offline cleanup.
   - Location: `unifiedItemsService.subscribeToBusinessInventory`.
   - Impact: no offline store cleanup on delete, no query cache removal, and duplicate channels if multiple screens are mounted (list + detail).
   - Status: resolved in Phase 1 (shared cache, single channel, offline/query cache cleanup).
3. No resync after offline queue flush or reconnect.
   - Project realtime does this; business inventory does not.
   - Impact: missed realtime events leave the list stale after offline sessions or transient disconnects.
4. Business inventory item detail does not handle removal.
   - Location: `BusinessInventoryItemDetail` uses list subscription and only updates when the item exists in the callback.
   - Impact: deleted/allocated items can remain visible until a manual refresh.
   - Status: resolved in Phase 1 (detail now sets item to null when missing).
5. No "post-write refresh" fallback.
   - Project inventory uses `refreshRealtimeAfterWrite` in list/detail flows.
   - Business inventory relies solely on realtime; any missed payload yields stale UI.

## Fix Plan (Detailed, Step-by-Step)
### Phase 1: Items Realtime Parity (Completed)
1. Add a shared realtime cache for business-inventory items.
   - File: `src/services/inventoryService.ts`.
   - Create a `businessInventoryRealtimeEntries` map similar to `projectItemsRealtimeEntries`.
   - Implement `subscribeToBusinessInventoryItems(accountId, callback, initialItems?, options?)`.
   - Use a single channel per account with `filter: account_id=eq.${accountId}` to reduce traffic.
2. Implement item event handling to mirror `subscribeToProjectItems`.
   - INSERT: only add when `project_id` is null; de-dupe by `item_id`.
   - UPDATE:
     - If `project_id` is null, upsert the item.
     - If `project_id` is not null, remove the item (it left business inventory).
   - DELETE:
     - Remove by `item_id`.
     - Purge from `offlineStore` and any conflict records for that item.
     - Remove item from React Query caches (e.g., `['business-inventory', accountId]` and `['item', accountId, itemId]`).
3. Keep ordering consistent.
   - Maintain the same sort as `getBusinessInventoryItems` (most recent first).
   - Sort after UPDATE/DELETE; for INSERT, insert at correct position if possible.
4. Replace usage.
   - `BusinessInventory`: swap `subscribeToBusinessInventory` for the new shared subscription.
   - `BusinessInventoryItemDetail`: use the new subscription, and if the item is missing from the snapshot, set `item` to null so the "Item not found" UI appears.

## Current Status (Updated Jan 17, 2026)
- Phase 1 complete: business inventory items share a realtime cache, use a single account channel, cleanup offline/query caches on delete, and item detail clears when removed.
- Phase 2 complete: business inventory transactions now use a filtered realtime subscription aligned with the initial fetch criteria.
- Phase 3 complete: business inventory refreshes items/transactions after reconnect and after offline sync completion, and offline services can trigger a business-inventory snapshot refresh after IndexedDB writes.
- Phase 4 pending: add post-write refresh fallback for business inventory views.

### Phase 2: Transactions Realtime Parity
1. Add a filtered subscription for business inventory transactions.
   - File: `src/services/inventoryService.ts`.
   - Implement `subscribeToBusinessInventoryTransactions(accountId, callback, initialTransactions?)`.
2. Filter logic must match initial fetch criteria.
   - Include transactions where `project_id` is null OR `reimbursement_type` is in `[CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT]`.
   - On UPDATE, recalculate inclusion and add/remove accordingly.
   - On DELETE, remove by `transaction_id`.
3. Maintain ordering identical to initial list (newest first by `created_at`).
4. Replace usage.
   - `BusinessInventory`: replace `subscribeToAllTransactions` with the new filtered subscription.
   - Keep the local de-dupe step as a safety net, but it should become redundant.

### Phase 3: Resync and Offline Parity
1. Add a refresh utility for business inventory collections.
   - Create a `refreshBusinessInventoryCollections(accountId)` function in `BusinessInventory` that re-fetches items and transactions and seeds the realtime caches with the fresh data.
2. Refresh on reconnect and after offline sync completes.
   - Mirror the `ProjectRealtimeContext` behavior:
     - Subscribe to network status changes; on offline->online, call `refreshBusinessInventoryCollections`.
     - Subscribe to `onSyncEvent('complete')` and refresh when `pendingOperations` is zero.
3. Optional but recommended: add an explicit offline snapshot callback.
   - Extend `realtimeSnapshotUpdater.ts` with a `registerBusinessInventoryRefreshCallback`.
   - Call it from offline item/transaction services after IndexedDB writes complete.
   - The callback should trigger `refreshBusinessInventoryCollections`.

### Phase 4: Add Post-Write Safety Refresh
1. For write flows in `BusinessInventory` and `BusinessInventoryItemDetail`, add a lightweight refresh fallback.
   - After delete/batch allocation/disposition changes, call `refreshBusinessInventoryCollections`.
   - This should be debounced or guarded so it does not run excessively while realtime is healthy.

## Acceptance Criteria (Must Pass)
- Creating, updating, deleting a business inventory item updates the list and detail view immediately.
- Allocating an item to a project removes it from business inventory views without a full page reload.
- Business inventory transactions list never includes unrelated project transactions after realtime updates.
- After reconnecting from offline, items and transactions reflect the server state within one refresh cycle.
- Deleting an item removes it from offline caches and any related query caches.

## Test Plan
- Create, update, delete business inventory items; verify list and detail update instantly.
- Allocate an item to a project; verify it disappears from business inventory and appears in the project view.
- Create a non-inventory project transaction; verify it does not appear in business inventory after realtime updates.
- Simulate offline item creation and sync; verify list refresh after reconnect or sync completion.
