# Transaction list shows deleted rows after creating new transaction

**Reported:** 2026-01-07  
**Status:** Resolved (2026-01-07)  

## Summary
After deleting all but two transactions and then creating a new transaction in a fresh dev session, the Projects → Transactions list  repopulates with previously deleted “ghost” rows as soon as the form navigates back to the list view. A manual browser refresh clears the ghosts, which means Supabase data is correct but the UI is rehydrating from stale local caches.

## Repro steps
1. Start the dev server (browser client online).
2. Navigate to a project’s transaction list.
3. Delete every transaction except two (using the standard UI delete flow).
4. Create a brand-new transaction.
5. When the Add Transaction flow completes and returns to the list, observe that the deleted transactions reappear until the page is manually refreshed.

## Expected vs actual
| | Expected | Actual |
| --- | --- | --- |
| After returning from Add Transaction | Only the two surviving transactions plus the newly created one should render. | Multiple previously deleted transactions repopulate the list and stay visible indefinitely until the user manually refreshes the page. |

## Notes / suspected areas
- `TransactionsList` calls `hydrateProjectTransactionsCache` before fetching from Supabase. That hydration reads `offlineStore.getTransactions(projectId)` and seeds React Query. If offlineStore still contains the deleted rows, they will show up immediately after navigation.
- Once that hydration succeeds, the page never reaches out to Supabase. The `loadTransactions` effect short-circuits as soon as the React Query cache has entries, so any stale offline rows stick around indefinitely until something else stomps over the cache. This is the branch that keeps firing after you return from Add Transaction:
```106:139:src/pages/TransactionsList.tsx
    const loadTransactions = async () => {
      if (!projectId || !currentAccountId) {
        setIsLoading(false)
        return
      }

      if (!propTransactions) {
        try {
          await hydrateProjectTransactionsCache(getGlobalQueryClient(), currentAccountId, projectId)
          const queryClient = getGlobalQueryClient()
          const cachedTransactions = queryClient.getQueryData<Transaction[]>(['project-transactions', currentAccountId, projectId])
          
          let transactionData: Transaction[] = []
          if (cachedTransactions && cachedTransactions.length > 0) {
            transactionData = cachedTransactions
          } else {
            transactionData = await transactionService.getTransactions(currentAccountId, projectId)
          }
          
          setTransactions(transactionData)
        } finally {
          setIsLoading(false)
        }
      }
    }
```
  Hard-refresh works only because the new browser session instantiates a fresh React Query client, forcing at least one Supabase fetch (which re-syncs the offline cache) before hydration can reapply stale rows.
- The delete flow (`transactionService.deleteTransaction` and `operationQueue.executeDeleteTransaction`) is supposed to delete from IndexedDB and remove cached queries. Either the IndexedDB delete is failing silently or there is another path (e.g., bulk deletes, multi-project lists) that does not call the cleanup helpers.
- Because a hard refresh clears the ghosts, Supabase is returning the correct dataset; the bug is strictly cache/hydration related.

## Resolution (2026-01-07)
Transactions now refresh from Supabase even after a successful offline hydration so that stale IndexedDB snapshots can never be the final truth on re-entry to the list:

- `TransactionsList` continues to hydrate React Query from `offlineStore` to prevent empty flashes, but it now unconditionally calls `transactionService.getTransactions` right after hydration and overwrites the React state with the fresh server payload once it arrives.
- The realtime subscription is only established after that fetch (or with the freshest cached snapshot when offline), ensuring the subscription’s internal cache starts from the authoritative dataset and cannot reintroduce ghost rows.

Manual verification: deleting all but two transactions, creating a new one, and returning to the list no longer rehydrates phantom rows; the list matches Supabase immediately without requiring a browser refresh.

