# Plan: Eliminate stale item-list ghosts after deletes

**Author:** GPT-5.1 Codex  
**Date:** 2026-01-07  
**Status:** Draft

## Context
- Transaction lists now hydrate from `offlineStore` but always follow with `transactionService.getTransactions`, preventing deleted rows from resurfacing after navigation.
- Item surfaces are mostly driven through `ProjectRealtimeContext`, yet some standalone pages (e.g., `TransactionItemsList`, `ItemDetail`, future inventory utilities) still rely on ad-hoc hydrators that may short-circuit once React Query already holds data.
- When a user deletes items or moves them between projects, IndexedDB can carry stale snapshots until the next successful Supabase sync. If a list view reuses that snapshot without forcing a network reconciliation, “ghost” items reappear until the browser hard-refreshes.

## Goals
1. Ensure every UI that presents project or transaction items performs a best-effort network fetch after hydration, even when cached data exists.
2. Keep optimistic/offline-created items visible immediately, but reconcile them with Supabase as soon as connectivity allows.
3. Maintain a single source of truth for realtime subscriptions so they bootstrap from the freshest dataset available.

## High-Level Approach
1. **Audit item list entry points**
   - Catalog all components/pages that read `project-items` or `transaction-items` query keys (`ProjectRealtimeContext`, `ItemDetail`, `TransactionItemsList`, any custom hydrators in forms or wizards).
   - Note which of them already call `unifiedItemsService.getItems*` unconditionally versus those that bail once cache has entries.
2. **Introduce a shared “hydrate then reconcile” helper**
   - Add `loadProjectItemsWithReconcile()` and `loadTransactionItemsWithReconcile()` utilities that:
     1. Call `hydrateProjectItemsCache` / `hydrateTransactionItemsCache`.
     2. Read the cached snapshot (set state immediately if non-empty).
     3. Always await `unifiedItemsService.getItemsByProject` or `getItemsForTransaction`, update state, and return that array (even if offline → falls back to IndexedDB).
   - Export these helpers so pages mirror the TransactionsList fix without duplicating logic.
3. **Update consumers**
   - For any page that currently does `if (cachedItems) { use them; return }`, switch to the new helper.
   - Ensure realtime subscriptions (`ProjectRealtimeContext`, `TransactionDetail` lineage watchers, etc.) are initialized *after* the reconcile call resolves (or with the freshest snapshot obtained during the process).
4. **Instrument and guard**
   - Similar to transactions, wrap hydration with ghost-prevention checks (`offlineStore.getItemById`) to avoid resurrecting IDs already removed from IndexedDB.
   - Log when the reconcile fetch falls back to offline data because of network issues, so we can monitor how often offline writes are causing divergence.
5. **Testing strategy**
   - Manual: delete/move items, navigate away and back without refreshing; ensure lists stay clean.
   - Automated: add a regression test around the item-list hook (if available) that fakes a stale cache and asserts the reconcile code path calls the fetcher.

## Task Breakdown
| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 1 | Inventory every item-list consumer and document which ones need changes | TBD | Grep for `hydrateProjectItemsCache`, `hydrateTransactionItemsCache`, `getQueryData(['project-items'…])`. |
| 2 | Implement shared `loadProjectItemsWithReconcile` helper (utils or service layer) | TBD | Mirror TransactionsList flow; return both cached + fetched snapshots. |
| 3 | Update UI entry points (ItemDetail, TransactionItemsList, wizards) to use helper and delay subscription setup until reconcile completes | TBD | Verify no double-fetch loops with `ProjectRealtimeContext`. |
| 4 | Add optional background refetch in `ProjectRealtimeContext.fetchAndStoreItems` to ensure it’s always firing even when seeded with offline data | TBD | Likely already true, but confirm. |
| 5 | QA pass (online/offline delete, move, optimistic create) + write regression notes | TBD | Capture screenshots/GIFs if ghosts previously repro on those screens. |

## Open Questions
- Do we have any item list that *must* stay fully offline (e.g., mobile field usage) where automatic network refetch would be undesirable?
- Should the reconcile helper accept a flag to skip Supabase fetch when `isNetworkOnline()` is false, or is the existing `unifiedItemsService` offline fallback sufficient?
- Can we share more logic with transactions (generic “hydrate + reconcile + seed subscription” helper) to reduce duplication?

## Definition of Done
- Every item list that previously relied on cache-only hydration now issues a follow-up fetch and seeds subscriptions with the result.
- No “ghost” items remain after deleting/moving entries and immediately returning to the list without a hard refresh.
- Documentation (this doc + relevant findings) updated with verification notes and any follow-up actions.

