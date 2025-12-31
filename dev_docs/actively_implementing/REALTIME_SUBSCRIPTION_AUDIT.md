# Realtime Subscription Audit — December 30, 2025 (Updated)

## Executive Summary
- Transaction detail, invoice, and summary routes now mount outside `ProjectLayout`, so the legacy realtime owner tore down Supabase channels exactly when operators drilled into a record, leaving duplicate/merge operations invisible until a hard reload.
- `ProjectRealtimeProvider` wraps the entire app, reference-counts each `projectId`, and exposes refresh helpers so duplicate, merge, upload, and background-sync flows proactively refetch data whenever realtime payloads lag or reconnect.
- Operators get immediate feedback through the new `SyncStatus` overlay plus `NetworkStatus` banner, which show queue depth, Supabase socket health, and provide a single-click manual sync that bridges the service worker and foreground operation queue.
- Background Sync now forwards `sync-operations` events to whichever tab is active; the tab runs `operationQueue.processQueue()` and reports completion, ensuring offline edits flush once connectivity returns instead of relying purely on realtime.

## Context
- Supabase realtime events should keep transactions and items in sync across the UI (duplication, imports, background uploads, etc.).
- Recent product work introduced transaction detail routes that sit outside `ProjectLayout`, which used to own every subscription.
- Operators observed that duplicating a transaction item updates Supabase but the UI remains stale until a manual reload.

## Current Architecture (High-Level)
1. `ProjectRealtimeProvider` (mounted in `App.tsx`) owns all Supabase realtime channels for the active account. Any route that calls `useProjectRealtime(projectId)` increments a reference count so the provider keeps the project’s `project`, `transactions`, `items`, and lineage subscriptions alive even when the original owner unmounts.
2. `ProjectLayout`, transaction/detail views, invoice + summary pages, and business-inventory routes consume provider snapshots instead of wiring their own listeners. They call the provider’s `refreshProject` / `refreshCollections` helpers for deterministic refetches after heavy writes or reconnect events.
3. Write-heavy transaction flows (duplicate/merge handlers, uploads, deletes) now invoke the provider refresh helpers immediately after Supabase writes; item-level delete paths still need the same treatment (see Findings + Remediation).
4. `SyncStatus` + `useRealtimeConnectionStatus` continue to monitor socket health, while the provider exposes channel counts so we can warn operators whenever active channels exist but the Supabase socket is reconnecting.
5. The custom service worker delegates `sync-operations` events to any active client, which then runs `operationQueue.processQueue()` and reports completion back via `PROCESS_OPERATION_QUEUE_RESULT`.

## Observability & Operator Feedback
1. `SyncStatus` polls the operation queue, listens for service-worker completion events, and surfaces Supabase reconnect warnings through `useRealtimeConnectionStatus`, giving operators a single overlay for queue depth, errors, and manual sync triggers.  
   ```1:129:src/components/SyncStatus.tsx```  
   ```1:65:src/hooks/useRealtimeConnectionStatus.ts```
2. `NetworkStatus` uses `useNetworkState` (backed by `/ping.json` and optional Supabase ping fallbacks) to distinguish between “offline” and “slow connection” states before realtime errors appear, so users know whether they can keep editing.  
   ```1:34:src/components/NetworkStatus.tsx```  
   ```1:118:src/hooks/useNetworkState.ts```  
   ```1:4:public/ping.json```
3. Service worker + queue instrumentation ensures every Background Sync has a foreground owner; manual sync buttons piggyback on the same `PROCESS_OPERATION_QUEUE` handshake so operators see success/failure without opening DevTools.  
   ```25:105:public/sw-custom.js```  
   ```360:394:src/services/operationQueue.ts```  
   ```1:220:src/services/serviceWorker.ts```

## Remediation — December 31, 2025
1. **Resolved — Transaction delete ghosts on detail views.** After deleting a transaction, `TransactionDetail` now awaits `refreshRealtimeAfterWrite(true)` before navigation so the provider snapshot (and every routed consumer) drops the row immediately, even if realtime payloads lag.  
   ```558:567:src/pages/TransactionDetail.tsx```
2. **Resolved — Item detail deletes trigger provider refresh.** `ItemDetail` derives the active project id, calls `useProjectRealtime(projectId)`, and awaits `refreshRealtimeAfterWrite()` before navigating away so every consumer loses the row even if realtime payloads trail.  
   ```450:477:src/pages/ItemDetail.tsx```
3. **Resolved — Project inventory bulk deletes force provider refresh.** `InventoryList` now waits for `refreshRealtimeAfterWrite()` before mutating local state, guaranteeing upstream lists drop the deleted ids immediately instead of hoping for realtime DELETE payloads.  
   ```49:517:src/pages/InventoryList.tsx```
4. **Resolved — Transaction delete ghosts triggered 406 fetches.** `transactionService.deleteTransaction` clears `transaction_id/latest_transaction_id` on every linked item before issuing the DELETE so no component keeps querying the removed row, `transactionService.subscribeToTransactions` removes rows by `transaction_id` or the surrogate `rowId`, and the new migrations `20251231_enable_transactions_replica_identity_full.sql` + `20251231_clear_orphaned_item_transactions.sql` ensure DELETE payloads stay rich while existing orphaned items are backfilled.  
   ```1248:1367:src/services/inventoryService.ts```  
   ```1:2:supabase/migrations/20251231_enable_transactions_replica_identity_full.sql```  
   ```1:11:supabase/migrations/20251231_clear_orphaned_item_transactions.sql```

## Findings (Latest)
| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | `ProjectLayout` unmounts on detail routes | ✅ Resolved | Provider keeps channels alive regardless of which route renders; layout/detail routes simply consume provider snapshots. |
| 2 | Transaction detail lacked subscriptions | ✅ Resolved | Detail view uses provider snapshots + lineage refreshes, and forces a provider refresh after heavy writes. |
| 3 | Duplicate handler assumed realtime | ✅ Resolved | `TransactionItemsList` now forces provider refreshes after duplicate/merge flows. |
| 4 | `useRealtimeSubscription` unused | ✅ Resolved | Hook re-exports `useProjectRealtime`; the provider centralizes channel management. |
| 5 | Background sync placeholder | ✅ Resolved | Service worker now asks the foreground queue to process pending operations and reports completion back. |
| 6 | Lineage per-item realtime channels exceed limits | ✅ Resolved | `lineageService` multiplexes all `item_lineage_edges` INSERTs through `accountChannelRegistry`, so inventories register listeners per item while sharing a single Supabase channel per account. |
| 7 | Item/inventory deletes skip provider refresh | ✅ Resolved | `ItemDetail` and `InventoryList` await `refreshRealtimeAfterWrite()` before mutating UI state, ensuring provider snapshots drop the deleted rows immediately. |
| 8 | Transaction delete ghosts trigger 406 fetches | ✅ Resolved | Transaction deletes now detach every linked item (clearing `transaction_id/latest_transaction_id`), `subscribeToTransactions` removes rows via `transaction_id` or fallback `rowId`, `REPLICA IDENTITY FULL` keeps realtime payloads rich, and `20251231_clear_orphaned_item_transactions.sql` backfills existing data. |
| 9 | Project items realtime cache ignored manual refreshes | ✅ Resolved | Manual refreshes updated provider snapshots but left `projectItemsRealtimeEntries` stale, so the next Supabase payload rehydrated already-deleted rows. `unifiedItemsService.syncProjectItemsRealtimeCache(...)` now injects fetched snapshots back into the shared cache (invoked from `fetchAndStoreItems`), so realtime INSERT/UPDATE/DELETE diffs always start from server-truth. |

## Regression: Lineage subscriptions overwhelm Supabase limits (Resolved)
- **Impact (historical):** Inventory, business inventory, and detail screens previously opened a Supabase channel per visible item, quickly tripping `ChannelRateLimitReached` and `ClientJoinRateLimitReached` errors that stalled lineage updates.
- **Resolution:** `lineageService` now routes every `item_lineage_edges` insert through a single per-account channel created by `getOrCreateAccountChannel`, while dispatching callbacks via lightweight listener maps so components can subscribe per item without spawning extra channels.
- **Follow-up:** Continue load-testing large inventories to ensure listener fan-out stays inexpensive and surface warnings in `SyncStatus` if channel errors appear again.

## Root Cause
The original realtime design assumed `ProjectLayout` would stay mounted for all project-specific routes. When detail screens moved outside of that component, the realtime owner began unmounting exactly when a user drilled into a transaction. Because the replacement screen never restored its own `transactions`/`items` channels (and even disabled the dedicated transaction subscription for debugging), all live updates stopped propagating, leaving the UI static until a hard reload.

## Current Recommendations
1. **Provider telemetry:** Persist per-project channel counts + last refresh timestamps inside provider snapshots so `SyncStatus` can highlight which projects are stale whenever Supabase reconnects.
2. **Snapshot reuse on reports:** Invoice, client summary, and property-management pages now register projects with the provider but still fetch their own data. Refactor them to consume provider snapshots to avoid duplicate queries.
3. **Multi-project coverage:** Add regression tests that open two projects simultaneously (e.g., two tabs) to verify reference counting + cleanup.
4. **Channel health surfacing:** Extend `useRealtimeConnectionStatus` to capture Supabase channel error events and display a per-project warning when a channel disconnects without recovering.
5. **Shared lineage bus:** Replace per-item Supabase subscriptions with an account-scoped channel that multiplexes lineage events to registered listeners, preventing rate-limit errors and simplifying teardown.

- **Resolution — Shared realtime cache now mirrors manual refreshes.**  
  - **Root cause:** `ProjectRealtimeProvider.refreshCollections()` fetched fresh items but only patched context state; `projectItemsRealtimeEntries` (the shared realtime cache) kept its pre-refresh array, so the next INSERT/UPDATE event merged against stale data and reintroduced deleted rows.  
  - **Fix:** Added `unifiedItemsService.syncProjectItemsRealtimeCache(accountId, projectId, items)` and call it from `fetchAndStoreItems` so every forced refresh overwrites the shared cache before later realtime diffs run.  
  - **Verification:** Bulk delete three duplicates, run duplicate again; item count stays stable (2 → delete → 1 → duplicate → 2) with no phantom entries. Logged payloads now merge against the refreshed cache instead of resurrecting deleted rows.

## Next Steps
- Persist per-project telemetry (channel counts, last refresh timestamps, last disconnect reason) on the provider snapshots and surface them inside `SyncStatus` / `NetworkStatus`.
- Refactor invoice/client-summary/property-management views to consume provider snapshots instead of making redundant Supabase fetches.
- Add Vitest coverage for multi-project reference counting and teardown (simulate two tabs registering/releasing the same project).
- Extend `useRealtimeConnectionStatus` to capture Supabase channel error events and display a per-channel warning when disconnects persist for >10 s.
- Monitor background-sync initiated queue flushes in production; add retries/backoff if no controlled clients respond to `PROCESS_OPERATION_QUEUE` within 5 s.
- Load-test the shared lineage channel registry to confirm channel counts stay constant while scrolling large inventories, and alert if listener fan-out begins to degrade performance.

## Verification
### Automated
- `ProjectRealtimeProvider` unit tests mock realtime payloads to ensure duplicate/merge visibility updates flow through the provider and that manual refreshes exercise reconnect paths.  
  ```1:116:src/contexts/__tests__/ProjectRealtimeContext.test.tsx```
- `useRealtimeConnectionStatus` tests simulate channel state changes to confirm the hook flags reconnect warnings whenever channels exist but the socket is closed.  
  ```1:66:src/hooks/__tests__/useRealtimeConnectionStatus.test.tsx```

### Manual
- Duplicate a transaction item inside an open detail view and verify the cloned row appears within ~1 s without reloading; confirm `SyncStatus` stays green.
- Open Project Layout + Transaction Detail in separate tabs, then close one tab and ensure the remaining tab keeps receiving realtime payloads (reference count decrements without tearing down channels).
- Force offline mode (disable network), create a transaction, re-enable network, and confirm the service worker triggers `operationQueue.processQueue()` plus updates `SyncStatus` back to green once Supabase accepts the writes.

## Implementation Status — December 30, 2025 (Updated)
- `ProjectRealtimeProvider` now wraps the app and centralizes Supabase channel lifecycle + lineage refreshes. Consumers register/release project IDs, and the provider exposes typed refresh helpers for forced refetches.  
  ```36:173:src/App.tsx```  
  ```1:418:src/contexts/ProjectRealtimeContext.tsx```
- `ProjectLayout`, transaction detail, invoice, property-management, client-summary, and business-inventory routes call `useProjectRealtime(...)`, ensuring all project-specific screens share the same realtime snapshots.  
  ```96:173:src/pages/ProjectLayout.tsx```  
  ```73:175:src/pages/TransactionDetail.tsx```  
  ```49:77:src/pages/ProjectInvoice.tsx```  
  ```23:40:src/pages/PropertyManagementSummary.tsx```  
  ```26:43:src/pages/ClientSummary.tsx```
- `TransactionDetail` delete handler now awaits `refreshRealtimeAfterWrite(true)` so removing a transaction immediately updates the shared snapshot and list views even if realtime payloads lag.  
  ```558:567:src/pages/TransactionDetail.tsx```
- `TransactionItemsList` hardens duplicate + merge flows by invoking the provider’s `refreshCollections` fallback immediately after Supabase writes.  
  ```409:757:src/components/TransactionItemsList.tsx```
- `public/sw-custom.js` now forwards background sync events to any active client, which in turn calls `operationQueue.processQueue()` and reports completion back to the service worker.  
  ```25:105:public/sw-custom.js```  
  ```360:394:src/services/operationQueue.ts```
- `SyncStatus`, `NetworkStatus`, and `useNetworkState` surface queue depth, manual sync controls, and realtime socket warnings backed by `/ping.json` and Supabase socket polling.  
  ```1:129:src/components/SyncStatus.tsx```  
  ```1:34:src/components/NetworkStatus.tsx```  
  ```1:118:src/hooks/useNetworkState.ts```  
  ```1:65:src/hooks/useRealtimeConnectionStatus.ts```  
  ```1:4:public/ping.json```
- Added Vitest coverage that mocks realtime payloads to ensure duplicate/merge visibility updates propagate through the provider, and verified the connection-status hook flags reconnect states when channels exist but the socket is closed.  
  ```1:116:src/contexts/__tests__/ProjectRealtimeContext.test.tsx```  
  ```1:66:src/hooks/__tests__/useRealtimeConnectionStatus.test.tsx```

