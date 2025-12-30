## Item Lineage Realtime Subscriptions Rollout

### Background
- **Goal**: Keep UI in sync as items move between transactions and inventory by subscribing to `item_lineage_edges` inserts (append-only). This enables immediate updates for:
  - TransactionDetail: “In this transaction” vs “Moved” sections
  - Item detail pages: breadcrumb/history and metadata
  - Inventory and project lists: badges and navigation targets

- **DB prerequisites** (already in repo):
  - Migration `014_enable_item_lineage_rls.sql` enables RLS on `item_lineage_edges`, adds SELECT/INSERT policies for account members, and adds the table to `supabase_realtime` publication.
  - Ensure helper functions referenced in policies exist (`can_access_account`, `is_system_owner`).

- **App primitives** (available):
  - `lineageService.subscribeToItemLineageForItem(accountId, itemId, callback)`
    - Subscribes to `INSERT` on `item_lineage_edges` filtered by `account_id` and `item_id`.
  - `lineageService.subscribeToEdgesFromTransaction(accountId, fromTransactionId, callback)`
    - Subscribes to `INSERT` where `from_transaction_id` matches a specific transaction (used to detect “moved out”).


### Usage examples

Item-level subscription
```ts
import { lineageService } from '@/services/lineageService'

useEffect(() => {
  if (!currentAccountId || !itemId) return
  const unsubscribe = lineageService.subscribeToItemLineageForItem(
    currentAccountId,
    itemId,
    (edge) => {
      // Update local state (e.g., recompute breadcrumb/path)
    }
  )
  return () => unsubscribe()
}, [currentAccountId, itemId])
```

Transaction-level (“moved out” of this transaction)
```ts
import { lineageService } from '@/services/lineageService'

useEffect(() => {
  if (!currentAccountId || !transactionId) return
  const unsubscribe = lineageService.subscribeToEdgesFromTransaction(
    currentAccountId,
    transactionId,
    () => {
      // Refresh items: recompute “In this transaction” vs “Moved”
      refreshTransactionItems()
    }
  )
  return () => unsubscribe()
}, [currentAccountId, transactionId])
```

### Page-by-page todos

- TransactionDetail (`src/pages/TransactionDetail.tsx`) — STATUS: done
  - Use `subscribeToEdgesFromTransaction(accountId, transactionId, ...)` to refresh sections in realtime.

- ItemDetail (`src/pages/ItemDetail.tsx`)
  - Subscribe with `subscribeToItemLineageForItem(accountId, itemId, ...)`.
  - On new edge: update breadcrumb (already handled by `ItemLineageBreadcrumb`) and optionally refetch the item if needed.

- BusinessInventoryItemDetail (`src/pages/BusinessInventoryItemDetail.tsx`)
  - Same as ItemDetail: subscribe per item and keep breadcrumb/metadata in sync.

- BusinessInventory (`src/pages/BusinessInventory.tsx`)
  - Augment existing items subscription with lineage edges to reflect moves to inventory immediately.
  - Approach A: subscribe per visible item via `subscribeToItemLineageForItem`.
  - Approach B (optional enhancement): add an account-wide helper (e.g., `subscribeToAccountEdges`) to funnel all edges; update local lists accordingly.

- InventoryList (`src/pages/InventoryList.tsx`)
  - Similar to BusinessInventory. Ensure list membership/badges update when an item’s latest association changes due to an edge.

- ProjectDetail (`src/pages/ProjectDetail.tsx`)
  - After loading project transactions, subscribe via `subscribeToEdgesFromTransaction` for each relevant transaction to reflect item membership changes immediately.
  - Keep unsubscribe functions per transaction and clean up on unmount.

- Optional: Projects / TransactionsList
  - Subscribe only if these views need to reflect lineage-related indicators in realtime (e.g., “has moved items” badges).

### Practical next steps (for implementers)
These are short, actionable steps another developer can follow to finish the rollout.

- Convert `ItemDetail` and `BusinessInventoryItemDetail`
  - Replace polling or existing item subscriptions with `lineageService.subscribeToItemLineageForItem(currentAccountId, itemId, callback)`.
  - In the callback: update `ItemLineageBreadcrumb` (which already supports subscription) and optionally refetch the item row if other metadata changes are expected.
  - Always call `unsubscribe()` on unmount or when `itemId`/`accountId` changes.

- Convert `BusinessInventory` and `InventoryList`
  - Preferred: subscribe per visible item using `subscribeToItemLineageForItem` as components mount to scope traffic.
  - Alternative: account-wide subscription helper (only if necessary) — beware volume and debounce UI updates.
  - Ensure lists update when an edge with `to_transaction_id = null` (moved to inventory) arrives.

- Convert `ProjectDetail`
  - After loading transactions, call `subscribeToEdgesFromTransaction` for each relevant transaction.
  - Keep per-transaction unsubscribe functions and clean them up on project changes/unmount.

 
- Cleanup
  - Replace older `useRealtimeSubscription` usages where they duplicate lineage-driven updates.
  - Remove any temporary polling fallback code.

### Acceptance criteria
- “In this transaction” vs “Moved” sections update without manual refresh when edges are inserted.
- Item detail breadcrumb updates immediately when an item is moved.
- Inventory and project lists reflect moves promptly (e.g., item appears in Business Inventory right after a `to = null` edge).
- No duplicate events or memory leaks (all subscriptions cleaned up on unmount/param change).
 
### Troubleshooting
- PostgREST schema cache (PGRST205 / 404 on table): wait a minute or refresh schema in Supabase UI.
- RLS errors: verify `can_access_account(account_id)` behavior and policy presence.
- Performance: prefer coarse-grained subscriptions (transaction-level, item-level) over subscribing to every table update; always unsubscribe on unmount.



