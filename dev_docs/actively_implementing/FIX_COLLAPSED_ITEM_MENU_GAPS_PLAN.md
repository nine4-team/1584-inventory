# Fix Collapsed Item Menu Gaps (Plan)

## Goal
Close the backend + UI gaps in the collapsed item actions menu so every menu entry is safe and behaves as intended:
- **Move To Design Business** is a **non-sale correction** (no allocation/deallocation).
- **Add To Transaction** is available in **Business Inventory**.
- **Transaction list** items do not attempt to update non‑persisted IDs.

## Current Gaps (Confirmed)
- **Move To Design Business** calls the **sale/deallocation** flow (incorrect).
- **Business Inventory** list + detail **lack Add To Transaction** handlers.
- **Transaction list** items always pass `onAddToTransaction`, even for **temp IDs**.

## Implementation Plan

### 1) Backend: add a non‑sale “Move To Design Business” API
**Intent:** correction only; no sale, no canonical transaction, no allocation logic.

**Proposed API**
- `unifiedItemsService.moveItemToBusinessInventory(accountId, itemId, sourceProjectId, options?)`
- Optional thin wrapper: `integrationService.moveItemToBusinessInventory(...)`

**Suggested behavior**
- Preconditions:
  - Item exists and is persisted.
  - Item is currently in `sourceProjectId`.
  - **Reject if tied to any transaction** (canonical or not). This is the safest choice for a “correction”.
- Mutation:
  - `projectId → null`
  - `transactionId → null` (only if you decide “correction” should fully detach; see questions)
  - `disposition`: either **preserve** or set to `'inventory'` (needs decision).
- Side effects:
  - Append a lineage edge indicating a **non-sale move**.
  - Update any cache / realtime invalidations used by other item updates.

**Notes**
- No migrations required if you rely on existing item fields + lineage.
- If you want a durable audit record distinct from canonical transactions, use lineage + audit logging.

### 2) UI wiring: separate “Move” and “Sell” handlers
**Goal:** “Move To Design Business” uses the new non‑sale API; “Sell” keeps deallocation.

**Change set**
- `ItemDetail.tsx`
  - `onSellToBusiness` → existing deallocation flow
  - `onMoveToBusiness` → new `moveItemToBusinessInventory`
- `InventoryList.tsx` (project inventory)
  - same split in `InventoryItemRow` handlers
- `ItemPreviewCard.tsx` stays unchanged (just uses handler props)

### 3) Add To Transaction: Business Inventory list + detail
**Goal:** enable menu entry and reuse existing transaction picker behavior.

**Business Inventory detail (`BusinessInventoryItemDetail.tsx`)**
- Add the same “Add To Transaction” dialog pattern used in `ItemDetail.tsx`:
  - `transactionService.getBusinessInventoryTransactions(...)`
  - `unifiedItemsService.updateItem(..., { transactionId })`
  - `unifiedItemsService.unlinkItemFromTransaction(...)`
- Wire `onAddToTransaction` into `ItemActionsMenu`.

**Business Inventory list (`BusinessInventory.tsx`)**
- Add transaction dialog state + handlers (parallel to `InventoryList.tsx`):
  - `openTransactionDialog(itemId)`
  - `handleChangeTransaction()`
  - `handleRemoveFromTransaction()`
  - Use `transactionService.getBusinessInventoryTransactions(...)`
- Pass `onAddToTransaction` into `InventoryItemRow`.

### 4) Transaction list: guard Add To Transaction for temp IDs
**Goal:** prevent update calls on non‑persisted items.

**Change**
- In `TransactionItemsList.tsx`, only pass `onAddToTransaction` when the item is persisted:
  - `onAddToTransaction={enablePersistedControls ? () => openTransactionDialog(item.id) : undefined}`
- This aligns with existing gating for `onChangeStatus` and bookmark.

## Validation / Test Plan
- **Move To Design Business**
  - Project item (no transaction): moves to business inventory **without** creating `INV_SALE_*`.
  - Item tied to any transaction: **disabled** + clear error if attempted.
- **Sell To Design Business**
  - Still creates/updates `INV_SALE_*` and moves to BI.
- **Add To Transaction (Business Inventory)**
  - From BI list + detail: assign, change, unlink works.
- **Transaction list**
  - Draft items: “Add To Transaction” disabled.
  - Persisted items: works as expected.

## Open Questions (Need Your Guidance)
1. **Move → Business** should it **clear `transactionId`** or simply **reject if set**? I assumed reject if set.
2. Should **disposition** be preserved or forced to `'inventory'` on move?
3. Should “Move → Business” be **available when offline**, or disabled like Sell → Project?
4. Any special copy for the non‑sale move confirmation/error?

## Files Likely Touched
- `src/services/inventoryService.ts` (new service method)
- `src/pages/ItemDetail.tsx`
- `src/pages/InventoryList.tsx`
- `src/pages/BusinessInventoryItemDetail.tsx`
- `src/pages/BusinessInventory.tsx`
- `src/components/TransactionItemsList.tsx`

