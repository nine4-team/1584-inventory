# Sell To Project Offline Audit

## Goal
Identify what must change so **Sell → Project** works both online and offline (including a queued/offline-first path) while keeping canonical sale/purchase transactions and lineage consistent.

## Current Behavior (Online-Only)
- **UI** always enables “Sell To Project…” and calls `integrationService.sellItemToProject(...)` from:
  - `src/pages/ItemDetail.tsx`
  - `src/pages/InventoryList.tsx`
- **Service** hard-fails offline:
  - `unifiedItemsService.sellItemToProject(...)` throws `SellItemToProjectError('OFFLINE', ...)` when `!isNetworkOnline()`.
- **Orchestration** is a two-step online flow:
  1. `deallocationService.handleInventoryDesignation(...)` creates/updates `INV_SALE_<sourceProjectId>` and moves the item to business inventory.
  2. `unifiedItemsService.allocateItemToProject(...)` creates/updates `INV_PURCHASE_<targetProjectId>` and allocates the item to the target project.
- **No offline queue path** exists for this action (see operation queue types below).

## Offline Support Gaps (Why It Fails Offline)
1. **Hard offline guard** in `sellItemToProject` prevents any fallback or queuing.
2. **Deallocation + allocation are online-only**:
   - Both call Supabase and require `ensureAuthenticatedForDatabase()`.
3. **Operation queue has no Sell action**:
   - `src/types/operations.ts` only supports CRUD for items/transactions/projects. There is no `SELL_ITEM_TO_PROJECT` or equivalent.
4. **Offline transaction creation doesn’t match canonical IDs**:
   - Offline transaction creation uses `T-...` IDs, not `INV_SALE_...` / `INV_PURCHASE_...`.
5. **No offline representation of canonical sale/purchase**:
   - Offline stores can persist items/transactions, but there is no defined strategy for keeping canonical transaction state consistent while offline.
6. **UI/UX doesn’t represent queued/partial state**:
   - The UI currently only shows an error when offline and does not mark a pending sell or disable conflicting actions.

## Required Changes (Audit Findings)

### A) Service-Layer Support for Offline Sell → Project
You need an explicit offline-capable entry point. Two viable strategies:

**Strategy 1: Queue-and-sync (recommended for correctness)**
- When offline, **queue** a Sell operation and show a “pending sync” state in UI.
- On reconnect, the queue **executes the server-side orchestration** (same steps as online).
- Required additions:
  - **New operation type** in `src/types/operations.ts`, e.g. `SELL_ITEM_TO_PROJECT`.
  - **Queue executor** in `operationQueue.ts` that calls a backend method (or RPC).
  - **Idempotency key** stored with the queued operation to avoid duplicate sells on retries.
  - **Local optimistic state** to prevent user confusion (see UI section below).

**Strategy 2: Fully offline simulation**
- Create/update offline `INV_SALE_<sourceProjectId>` and `INV_PURCHASE_<targetProjectId>` entries and mutate the item locally.
- Then queue a server-side replay of the same steps when back online.
- Higher complexity: must reconcile local canonical transactions with server truth.

Given the current architecture, **Strategy 1 is lower risk** and more consistent with existing queue patterns.

### B) Operation Queue & Types
Add a first-class sell operation:
- **`src/types/operations.ts`**:
  - Add new `OperationType`: `SELL_ITEM_TO_PROJECT`.
  - Define operation data: `itemId`, `sourceProjectId`, `targetProjectId`, `amount`, `notes`, `space`, `idempotencyKey`.
- **`src/services/operationQueue.ts`**:
  - Handle new operation type in `execute(...)`.
  - Execute via a **single authoritative backend entry point** (see section C).
  - Add conflict detection and proper retry behavior.

### C) Single Authoritative Backend Entry Point
The queued offline operation must call a **single function** that performs the sale → purchase orchestration atomically (or with explicit partial-failure handling):
- Current: `unifiedItemsService.sellItemToProject(...)` is the right entry point, but it is **online-only** and **not queue-aware**.
- Required change:
  - Add an **offline-aware wrapper** (or change existing method) so that:
    - Online path runs the current orchestration.
    - Offline path **queues** the operation and returns a “queued/pending” result.
  - OR add a Postgres RPC and have the queue call the RPC directly.

### D) Optimistic Local State + Pending Sync UX
The app must show that the sell is **queued** and prevent conflicting actions:
- Add an explicit “pending sell to project” state to items (local-only metadata):
  - Could be `pendingOperationId` or a local flag stored in `offlineStore`.
  - Prevents duplicate sells and conflicting moves/edits while pending.
- Update UI to reflect pending state (list + detail):
  - Show a small badge (e.g. “Pending sync”) and disable other actions.
  - Replace offline error toast with “Queued; will sync when online.”

### E) Offline Data Dependencies
To select a target project offline, the **project list must be available**:
- Verify that `projectService.getProjects(...)` and the list UI have a reliable offline fallback.
- If not, add a fallback to `offlineStore` so the project picker can still render while offline.

### F) Canonical Transaction Integrity
Sell → Project depends on canonical transaction IDs:
- If using **Strategy 1**, canonical transactions are created **on sync**, not offline.
- Ensure the queue execution:
  - Re-validates item state (project/location, transaction constraints).
  - Returns a **partial completion** error (same as online) if step 2 fails.
  - Records lineage edges after completion.

## Concrete Change List (Minimum Set)

### 1) Add Sell Operation to Offline Queue
- `src/types/operations.ts`
  - Add `SELL_ITEM_TO_PROJECT`.
  - Define `SellItemToProjectOperation` interface.
- `src/services/operationQueue.ts`
  - Add `executeSellItemToProject(...)` handler.
  - Call a single service/RPC method to perform the orchestration.

### 2) Make `sellItemToProject` Offline-Aware
- `src/services/inventoryService.ts`
  - When offline: **enqueue** Sell operation instead of throwing `OFFLINE`.
  - Return a structured response (e.g. `{ mode: 'offline', operationId }`) so UI can update state.

### 3) Add UI Pending State + Feedback
- `src/pages/ItemDetail.tsx`
- `src/pages/InventoryList.tsx`
- `src/components/items/ItemActionsMenu.tsx`
  - When offline: allow sell, queue it, show “Queued” toast.
  - Disable other actions while pending (or show a “Pending sync” badge).

### 4) Ensure Project Picker Works Offline
- Validate project list source during offline mode.
- Add offline fallback via `offlineStore` if missing.

### 5) Testing
- Add queue tests:
  - `operationQueue` execution for new op (success, retry, conflict).
- Add service tests for offline queuing behavior.
- Add UI tests or manual test steps:
  - Offline: sell → queued → badge appears.
  - Online: queued sell executes and item lands in target project with canonical transactions.
  - Partial completion: offline queued then online failure step 2 → item in business inventory with clear messaging.

## Files Involved (Known)
- `src/services/inventoryService.ts` (sell orchestration + offline enqueue)
- `src/types/operations.ts` (new operation type)
- `src/services/operationQueue.ts` (executor for new op)
- `src/pages/ItemDetail.tsx` (offline UI changes, queued state)
- `src/pages/InventoryList.tsx` (offline UI changes, queued state)
- `src/components/items/ItemActionsMenu.tsx` (pending state + disable rules)
- `src/services/offlineStore.ts` (optional: persist pending state)
- `src/services/offlineProjectService.ts` (if project list fallback needed)

## Decision Needed
Pick one of:
- **Queue-and-sync** (recommended) with “pending” UI state.
- **Full offline simulation** (more complex; requires canonical transaction mock + reconciliation).

Once that decision is made, implementation can proceed without blocking UI parity.
