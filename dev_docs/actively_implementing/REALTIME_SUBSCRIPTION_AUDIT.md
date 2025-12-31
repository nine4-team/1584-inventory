# Realtime Subscription Audit — December 30, 2025

## Context
- Supabase realtime events should keep transactions and items in sync across the UI (duplication, imports, background uploads, etc.).
- Recent product work introduced transaction detail routes that sit outside `ProjectLayout`, which used to own every subscription.
- Operators observed that duplicating a transaction item updates Supabase but the UI remains stale until a manual reload.

## Current Architecture (High-Level)
1. `ProjectLayout` loads `project`, `transactions`, and `items`, then subscribes to both tables via `transactionService.subscribeToTransactions` and `unifiedItemsService.subscribeToProjectItems`.  
   - File: `src/pages/ProjectLayout.tsx`
2. Subscriptions store live snapshots in local state and are shared with nested routes through `useProjectLayoutContext`.
3. Transaction detail routes (`/project/:projectId/transactions/:transactionId` and business-inventory variants) are defined **outside** the layout, so entering a detail page unmounts the component that owns the realtime streams.
4. `TransactionDetail` currently performs one-off fetches plus lineage edge subscriptions; the dedicated transaction subscription is commented out.
5. Item-level actions (duplicate, delete, etc.) rely on realtime callbacks to refresh the UI—they only mutate local arrays optimistically.

## Findings
| # | Area | Evidence | Impact |
|---|------|----------|--------|
| 1 | `ProjectLayout` unmount | `src/App.tsx` defines detail routes outside `ProjectLayout`. | Navigating into a transaction tears down both the `transactions` and `items` realtime channels. |
| 2 | Subscription disabled | `transactionService.subscribeToTransaction` call in `TransactionDetail` is commented out (lines 474‑508). | Even if `ProjectLayout` stayed mounted, the detail screen would still miss transaction updates. |
| 3 | No item subscription on detail view | Only `lineageService.subscribeToEdgesFromTransaction` is active. | Inserts/updates on `items` (duplicate, edit, image upload) never trigger refreshes. |
| 4 | Duplicate handler assumes realtime | `TransactionItemsList.handleDuplicateItem` merely spreads the existing `items` array after the Supabase write. | Without realtime, the duplicate is invisible until a manual refetch/reload. |
| 5 | Unused realtime hook | `src/hooks/useRealtime.ts` is not imported anywhere (`rg "useRealtimeSubscription" => 0 hits`). | There is no shared abstraction maintaining long-lived channels; each page reinvents (or omits) subscriptions. |

## Root Cause
The original realtime design assumed `ProjectLayout` would stay mounted for all project-specific routes. When detail screens moved outside of that component, the realtime owner began unmounting exactly when a user drilled into a transaction. Because the replacement screen never restored its own `transactions`/`items` channels (and even disabled the dedicated transaction subscription for debugging), all live updates stopped propagating, leaving the UI static until a hard reload.

## Recommendations (No code applied yet)
1. **Reattach realtime to detail views.** Re-enable `transactionService.subscribeToTransaction` inside `TransactionDetail` and add an `items` subscription scoped to `projectId` so duplicates, edits, and imports appear immediately.
2. **Keep `ProjectLayout` mounted** (e.g., render detail pages within the same layout or lift the realtime subscriptions into a top-level provider) to avoid losing channels when routes change.
3. **Call `refreshTransactionItems()` after write-heavy actions** (duplicate, delete, merge, uploads) so the UI updates even if realtime lags.
4. **Adopt `useRealtimeSubscription` (or a new `RealtimeProvider`)** to centralize channel lifecycle management and keep the Supabase socket alive across navigation.
5. **Add monitoring:** surface a warning in `SyncStatus`/`NetworkStatus` when the Supabase realtime socket disconnects, so operators know when auto-updates are paused.

## Next Steps
- Decide whether to keep realtime ownership inside `ProjectLayout` (by restructuring routes) or to create a reusable provider shared across routes.
- Once the ownership decision is made, implement the detail-screen subscriptions and re-enable the transaction-level listener.
- Backfill tests for duplicate/merge flows that ensure the UI reflects new items without reloads (could be a Vitest mock of realtime payloads).
- Document the expected subscription topology in `dev_docs/actively_implementing/offline-functionality` so future refactors maintain parity.
