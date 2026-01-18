# Duplication Realtime Gap: Project vs Business Inventory

## Problem
Duplicating items in Business Inventory does not update the list until a manual refresh, while Project inventory updates immediately.

## Why Project View Updates Immediately
- Project items are wired into a realtime subscription and shared cache via `ProjectRealtimeProvider`, which listens to `subscribeToProjectItems` and pushes updates into state.
- The duplication hook (`useDuplication`) intentionally avoids local state updates and relies on realtime events to refresh the UI.

## Why Business Inventory Does Not
- Business Inventory uses a custom duplication service that calls `unifiedItemsService.createItem`.
- That path does not update local state and depends on `subscribeToBusinessInventory` to emit an INSERT.
- If the item is queued offline or the realtime event is delayed/missed, the UI remains stale until reload.

## Evidence (Code References)
- `src/contexts/ProjectRealtimeContext.tsx` sets `items` immediately on realtime updates.
- `src/hooks/useDuplication.ts` expects realtime to update the UI.
- `src/pages/BusinessInventory.tsx` uses a custom duplication service with `createItem` but no local refresh.
- `src/services/inventoryService.ts` has separate realtime handlers for project items vs business inventory.

## What Needs to Change (Choose One)
1. **Explicit refresh after duplication**
   - After `createItem`, call `getBusinessInventoryItems` and `setItems`.
2. **Optimistic local update**
   - After `createItem`, fetch the new item by ID and insert into `items` state.
3. **Shared realtime cache for business inventory**
   - Add a cache sync method (similar to `syncProjectItemsRealtimeCache`) and update it after creation.

## Recommendation
Option 2 (optimistic update) or Option 3 (shared cache) best matches the project-side experience. The core gap is that Business Inventory duplication relies on realtime without a fallback update path.
