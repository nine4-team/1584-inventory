# Issue: Items incorrectly appear as 'sold' in canonical purchase transaction

**Status:** Active
**Opened:** 2026-02-09
**Resolved:** _pending_

## Context
- **Symptom:** When adding an existing item from business inventory (outside project) to a space via SpaceDetail, the item is correctly added to the canonical purchase transaction BUT also incorrectly appears as a "sold" item in that same transaction. Sold items should only appear when an item has moved OUT of a transaction via a sale.
- **Affected area:** SpaceDetail "add existing item" flow, canonical purchase transaction, sold items display
- **Severity:** Degraded - item is added but UI shows confusing/incorrect sold status
- **Reproduction steps:**
  1. Be on SpaceDetail screen
  2. Use "Add Existing Item" from business inventory (outside project) — item HAS a source transaction
  3. Item gets added to canonical purchase transaction
  4. That same item also shows as "sold" in the transaction
- **Environment:** Branch: supabase

## Research

### Flow trace: SpaceDetail → ensureItemInProjectForSpace → sellItemToProject → allocateItemToProject

1. **SpaceDetail.tsx:332** → `ensureItemInProjectForSpace()`
2. **itemPullInService.ts:15-43** → Two paths:
   - `!item.projectId` → `allocateBusinessInventoryToProject` → `allocateItemToProject`
   - Different projectId → `sellItemToProject` (deallocation then allocation)

3. **sellItemToProject (inventoryService.ts:5837-5953)**:
   - Step 1: `handleInventoryDesignation` — moves item out of source project
     - If item in `INV_PURCHASE_sourceProject` → **purchase-reversion** (line 7644): sets `transactionId = null`, `projectId = null`
     - Otherwise → creates `INV_SALE_sourceProject` transaction
   - Step 2: `allocateItemToProject` — moves item into target project
     - After purchase-reversion: item has no transactionId → **Scenario C** → `handleInventoryToPurchaseMove`
     - After sale creation: item has `INV_SALE_` → **Scenario A.2** → `handleSaleToDifferentProjectMove`

4. **handleInventoryToPurchaseMove (line 6424-6472)** — Scenario C:
   - Adds item to `INV_PURCHASE_{targetProject}` ✓
   - Creates lineage edge with `movementKind: 'sold'`

5. **TransactionDetail.tsx:507-514** — soldItems computation (BEFORE fix):
   - For business inventory transactions: looked at `edgesToTransaction` with `movementKind === 'sold'`
   - This showed items that ARRIVED at a transaction, not items that LEFT it

### Key files
- `src/pages/SpaceDetail.tsx` — Entry point, handleAddExistingItems
- `src/services/itemPullInService.ts` — ensureItemInProjectForSpace
- `src/services/inventoryService.ts` — allocateItemToProject, handleInventoryToPurchaseMove, sellItemToProject, handleInventoryDesignation
- `src/pages/TransactionDetail.tsx` — soldItems display logic
- `src/services/lineageService.ts:331` — getEdgesFromTransaction queries `item_lineage_edges` where `from_transaction_id = transactionId`
- `src/types/index.ts:461` — ItemLineageMovementKind type

## Investigation Log

### H1: soldItems display logic used wrong edge direction for business inventory transactions
- **Rationale:** The `soldItems` useMemo in TransactionDetail used `edgesToTransaction` (arrival edges) for business inventory transactions instead of `edgesFromTransaction` (departure edges). "Sold" items should only show items that LEFT a transaction, not items that arrived.
- **Experiment:** Traced the flow and confirmed `edgesToTransaction` was catching arrival edges with `movementKind: 'sold'`.
- **Evidence:**
  - TransactionDetail.tsx:510-512 (before fix) — `isBusinessInventoryTransaction ? edgesToTransaction : edgesFromTransaction`
  - The correct behavior (regular transactions) already used `edgesFromTransaction` with direction `'from'`
- **Verdict:** Confirmed — display logic was wrong

### Fix 1 applied: Removed isBusinessInventoryTransaction special case
- **Change:** TransactionDetail.tsx — soldItems now always uses `edgesFromTransaction` with direction `'from'`
- **Result:** Items no longer incorrectly appear as sold in DESTINATION transaction ✓
- **New problem:** Sold items are now MISSING from the SOURCE transaction — no sold section visible at all

### H2: Source transaction's edgesFromTransaction doesn't contain the expected 'sold' edges
- **Rationale:** After Fix 1, soldItems correctly looks at `edgesFromTransaction` (edges where `from_transaction_id = this transaction`). If the source transaction shows no sold items, the lineage edges must not have the source transaction as `from_transaction_id`.
- **Experiment:** User provided actual lineage edges from test item. Checked `from_transaction_id` values.
- **Evidence:** User's lineage edges show:
  - Edge 3: `from=ab6c665f, to=INV_PURCHASE_6bb65..., kind='association', source='db_trigger'` — db trigger recorded the move
  - Edge 4: `from=(null), to=INV_PURCHASE_6bb65..., kind='sold', source='app'` — the app 'sold' edge has `from=null`
  - **No 'sold' edge exists with `from_transaction_id = ab6c665f` (the source transaction)**
- **Verdict:** Confirmed — `from_transaction_id` is null in the 'sold' edge

### H2a: `handleInventoryToPurchaseMove` always writes `from_transaction_id = null`
- **Rationale:** The 'sold' edge with `from=null` matches `handleInventoryToPurchaseMove` (inventoryService.ts:6450) which hardcodes `null` as `fromTransactionId` because it assumes the item is "from inventory."
- **Experiment:** Read handleInventoryToPurchaseMove (line 6450): `appendItemLineageEdge(accountId, itemId, null, purchaseTransactionId, ...)`. Confirmed it always uses `null`.
- **Evidence:**
  - inventoryService.ts:6450 — `null` is hardcoded as `fromTransactionId`
  - inventoryService.ts:6042-6049 — both Scenario C and Fallback call `handleInventoryToPurchaseMove` without passing source transaction context
  - The item's `previousProjectTransactionId` IS set correctly by the deallocation step (`_resolvePreviousProjectLink` at line 7598 preserves it), but `handleInventoryToPurchaseMove` never reads it
  - Additionally, the Fallback case (line 6047-6049) handles items with non-canonical transactionIds (e.g., regular UUID like `ab6c665f`) — these items DO have a source transaction via `currentTransactionId` but it's never passed through
- **Verdict:** Confirmed — root cause of missing sold items in source transaction

## Conclusion
Two bugs:
1. **(Fixed)** TransactionDetail soldItems used `edgesToTransaction` for business inventory txns — showed items arriving, not leaving.
2. **(Root cause found)** `handleInventoryToPurchaseMove` (inventoryService.ts:6450) hardcodes `from_transaction_id = null` in the 'sold' edge. When called via Scenario C (after purchase-reversion nulls transactionId) or the Fallback (non-canonical transactionId), the source transaction context is lost. Fix: pass the source transaction ID (`currentTransactionId || item.previousProjectTransactionId`) into `handleInventoryToPurchaseMove` and use it as `from_transaction_id`.

## Resolution
- **Fix 1 (applied):** Removed `isBusinessInventoryTransaction` special case in soldItems computation. Now always uses `edgesFromTransaction` with direction `'from'`. Items no longer incorrectly appear as sold in destination transaction.
- **Fix 2 (applied):** Added `sourceTransactionId` parameter to `handleInventoryToPurchaseMove`. Updated `allocateItemToProject` to pass:
  - Scenario C: `item.previousProjectTransactionId` (set by deallocation step)
  - Fallback: `currentTransactionId || item.previousProjectTransactionId` (preserves non-canonical source transaction)
  - The 'sold' edge now uses this value as `from_transaction_id` instead of hardcoded `null`
- **Files changed:**
  - `src/pages/TransactionDetail.tsx` (lines 508-517)
  - `src/services/inventoryService.ts` (lines 6424-6431, 6042-6049, 6451)
- **Commit:** _pending_
- **Verified by user:** Pending — need to test with fresh sell flow

## Lessons Learned
_pending_
