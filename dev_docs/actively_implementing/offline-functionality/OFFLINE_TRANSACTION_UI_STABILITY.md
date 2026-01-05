# Offline Transaction UI Stability Fix

## Context
Offline transaction creation now succeeds (the `sum_item_purchase_prices` null issue is fixed), but the project UI still shows a poor experience when the device comes back online:

- The entire project view flashes to a blank “Loading…” state as soon as connectivity returns.
- Optimistic transactions that only exist in IndexedDB disappear from the list until the user manually refreshes, even though the queued create eventually succeeds.

Both behaviors stem from ProjectRealtime re-initialization logic, not from Supabase realtime.

---

## Symptoms

1. **Blank screen on reconnect.**  
   - `ProjectRealtimeProvider` re-runs `initializeProject` for every cache-hydrated project when `isOnline` flips to `true`.  
   - `initializeProject` sets `isLoading = true` immediately (`584:618`), so `ProjectLayout` replaces the entire view with a spinner even though we still have cached data.

2. **Optimistic transaction vanishes after sync.**  
   - `transactionService.getTransactions` returns only network rows.  
   - The moment `initializeProject` finishes, it overwrites the snapshot with those rows, so any transaction that lives exclusively in IndexedDB disappears from the list until the realtime INSERT arrives (or the page reloads).  
   - We already solved the analogous cache overwrite problem when *writing* to IndexedDB via `filterRowsWithPendingWrites`, but we never re-merge pending queue entries when *reading* from Supabase.

---

## Fix Plan

### 1. Refresh without toggling `isLoading`

- **Files:** `src/contexts/ProjectRealtimeContext.tsx`
- Replace the network-status handler that currently calls `initializeProject(projectId)` with a call to `refreshCollections(projectId, { includeProject: true })`.
  - `refreshCollections` fetches transactions + items (and optionally the project) without touching `isLoading`, so cached UI stays visible.
  - If we still want telemetry, emit a `lastCollectionsRefreshAt` patch after the refresh resolves (already handled inside `refreshCollections`).
- Optional: add an `isRefreshing` flag if the UI needs to show subtle activity (badge/toast) without hiding the page.

### 2. Keep pending offline transactions in every fetch

- **Files:** `src/services/inventoryService.ts`, `src/services/operationQueue.ts` (pending ID helper already exists)
- After each Supabase query inside `transactionService.getTransactions` and `getTransactionsForProjects`:
  1. Call `await operationQueue.getEntityIdsWithPendingWrites('transaction')`.
  2. For each pending ID, load the cached record via `offlineStore.getTransactionById` and convert it with `_convertOfflineTransaction`.
  3. Merge those transactions into the result set before `_enrichTransactionsWithProjectNames`, skipping any ID that is already present in the network payload.
- This mirrors the pattern used by `cacheTransactionsOffline`; optimistic rows remain in the snapshot until the queue clears or realtime delivers the canonical record.

### 3. (Nice-to-have) Trigger targeted snapshot refresh after queue success

- Ensure `operationQueue.executeCreateTransaction` (and the update/delete executors) call `refreshProjectSnapshot(projectId)` after writing the server echo back into IndexedDB.
- This already happens when the offline service queues a mutation, but firing another refresh after Supabase confirms the operation shortens the window before ProjectRealtime hydrates the canonical data.

---

## Exit Criteria

- Going offline, creating a transaction, and returning online keeps the existing list rendered with no spinner flash.
- The optimistic transaction remains visible throughout the reconnect window and is replaced by the server copy once the queue succeeds (without needing a manual refresh).
- ProjectRealtime telemetry still shows up-to-date timestamps for fetches and channel health.
