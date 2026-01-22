# UNIFIED_ITEM_MENU_READINESS_AUDIT (Online + Offline)

## Scope & sources

This audit covers **all unified item actions menu** (three-dot menu) actions defined in:
- `dev_docs/actively_implementing/COLLAPSE_ITEM_CONTROLS_INTO_THREE_DOT_MENU_PLAN.md`

And all contexts where the menu appears (currently wired):
- **Project inventory list**: `src/pages/InventoryList.tsx` → `src/components/items/InventoryItemRow.tsx` → `src/components/items/ItemPreviewCard.tsx` → `src/components/items/ItemActionsMenu.tsx`
- **Business inventory list**: `src/pages/BusinessInventory.tsx` → `InventoryItemRow` → `ItemPreviewCard` → `ItemActionsMenu`
- **Transaction item list**: `src/components/TransactionItemsList.tsx` → `ItemPreviewCard` → `ItemActionsMenu`
- **Item detail (project + BI routes)**: `src/pages/ItemDetail.tsx` → `ItemActionsMenu`
- **Business inventory item detail**: `src/pages/BusinessInventoryItemDetail.tsx` → `ItemActionsMenu`

This document tracks the readiness of these controls for offline use.

## Canonical action list (from plan)

Top-level (in order):
- Edit
- Make Copies…
- Add To Transaction…
- Sell ▸
- Move ▸
- Change Status ▸
- Delete…

Sell submenu:
- Sell To Design Business
- Sell To Project…

Move submenu:
- Move To Design Business
- Move To Project…

Change Status submenu:
- To Purchase
- Purchased
- To Return
- Returned

## Action-by-action readiness table

Legend:
- **Online**: ✅ supported, ⚠️ partially supported / fragile, ❌ not supported
- **Offline**: ✅ supported (queued/offline-first), ⚠️ partially supported / “updates but breaks related invariants”, ❌ not supported

| Action | Contexts currently wired | Online status | Offline status | Known gaps / notes |
|---|---|---:|---:|---|
| **Edit** | Project list, BI list, Tx item list (in-form), Item detail, BI detail | ✅ | ✅ | Pure UI navigation/state. `ItemActionsMenu` calls `onEdit` callback; in Tx list it sets `editingItemId` in `src/components/TransactionItemsList.tsx`. |
| **Make Copies…** | Project list (`InventoryList`), BI list (`BusinessInventory`), Item detail, BI detail, Tx item list | ✅ | ✅ | **Supported Offline.** Project duplication uses `unifiedItemsService.duplicateItem` which now supports offline queueing (via `createItem` and pending transaction updates). Business inventory duplication uses `unifiedItemsService.createItem` which is also offline-aware. |
| **Add To Transaction…** (assign/change/unlink) | Project list, BI list, Item detail, BI detail (assign/change only), Tx item list (limited) | ✅ | ✅ | **Supported Offline.** Now uses `unifiedItemsService.assignItemToTransaction` and `unlinkItemFromTransaction` which orchestrate item updates locally and queue pending `transaction.item_ids` modifications for sync. No longer breaks integrity offline. |
| **Sell → Sell To Design Business** | Project list, Item detail | ✅ | ✅ (queued) | Offline enqueues a canonical deallocation operation; executor runs `deallocationService.handleInventoryDesignation(...)` on sync and verifies canonical invariants. Menu unblocked. |
| **Sell → Sell To Project…** | Project list, Item detail | ✅ (with partial-completion semantics) | ✅ (queued) | Offline enqueues the canonical sell-to-project flow and runs the same orchestration on sync; invariants are verified post-execution. Menu unblocked. |
| **Move → Move To Design Business** | Project list, Item detail | ✅ | ✅ | Implemented via `integrationService.moveItemToBusinessInventory(...)`. Uses `unifiedItemsService.updateItem(...)` (offline-aware). Menu unblocked. |
| **Move → Move To Project…** | Project list, Item detail, BI list, BI detail | ✅ | ✅ | In **project list/detail**: simple `projectId` change via `updateItem` (offline-aware) ✅. In **business inventory**: uses `unifiedItemsService.allocateItemToProject(...)` which queues canonical allocation offline ✅. Menu unblocked. |
| **Change Status** (To Purchase/Purchased/To Return/Returned) | Project list, BI list, Tx item list, Item detail, BI detail | ✅ | ✅ | All wired paths ultimately use `unifiedItemsService.updateItem(..., { disposition })` which is offline-aware (delegates to `offlineItemService.updateItem` when offline). |
| **Delete…** | Project list, BI list, Item detail, BI detail | ✅ | ✅ | Uses `unifiedItemsService.deleteItem(...)` which is offline-aware and delegates to `offlineItemService.deleteItem` when offline (queues `DELETE_ITEM`). |

## Implementation status (current)

- **Phase 1 (safety for Add To Transaction)**: ✅ completed.
  - Implemented `unifiedItemsService.assignItemToTransaction` and `markTransactionItemIdsPending`.
  - Updated all UI call sites (`InventoryList`, `ItemDetail`, `BusinessInventory`, `TransactionItemsList`) to use the new offline-safe service method.
  - Removed offline disablement from `ItemActionsMenu`.
- **Phase 2 (offline-ready project duplication)**: ✅ completed.
  - Verified `unifiedItemsService.duplicateItem` uses `createItem` (offline-aware) and handles transaction linking via `markTransactionItemIdsPending` when offline.
- **Phase 3 (canonical flows offline strategy)**: ✅ completed (queued ops + executor + invariant checks).
- **Phase 4 (Menu Enablement)**: ✅ completed.
  - Removed artificial `!isOnline` checks from `ItemActionsMenu.tsx` for Sell, Move, and Add to Transaction actions. They now rely on the underlying queued service methods.

## Final Summary

All controls in the unified item menu are now **usable offline**. The application queues these operations (including complex moves, sales, and transaction assignments) and synchronizes them when connectivity is restored.
