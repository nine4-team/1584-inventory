# Transaction list shows deleted rows after creating new transaction

**Reported:** 2026-01-07  
**Status:** Investigating  

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

## Next steps
1. Reproduce locally with devtools open and verify whether `offlineStore.deleteTransaction` is throwing (look for “Failed to purge transaction from offline store...” warnings).
2. Inspect IndexedDB (`ledger-offline` → `transactions`) after deleting to confirm whether the rows are actually removed.
3. Add instrumentation inside `hydrateProjectTransactionsCache` to log which transaction IDs are being primed; compare to the server response that follows.
4. If deletes are happening while offline, ensure that the queued DELETE operation removes the cached transaction immediately (not only after replay).
5. Update `TransactionsList` (and any other hydrators) so they always trigger `transactionService.getTransactions` in the background even when hydration produced records, otherwise stale offline caches will never reconcile on navigation changes.

