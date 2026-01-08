# TransactionDetail item fetch 406s and greyed-out cards

**Reported:** 2026-01-07  
**Status:** Investigating  

## Summary
Opening the Brianhead Cabin purchase transaction (`9689e160-6232-48da-9bc4-1693201012ea`) floods the console with `GET ... /rest/v1/items … 406 (Not Acceptable)` errors for item IDs `I-1767139637044-6xqj` and `I-1767139637044-d2e0`. The transaction still lists five IDs in `transactions.item_ids`, but only three rows remain in `public.items`, so React Query eventually renders three dimmed “Moved items” and silently drops the two missing ones.

## What the errors mean
- The UI loads each `transaction.itemIds` entry via `unifiedItemsService.getItemById`, which executes a `.single()` PostgREST query:
  ```5172:5178:src/services/inventoryService.ts
          const { data, error } = await supabase
            .from('items')
            .select('*')
            .eq('account_id', accountId)
            .eq('item_id', itemId)
            .single()
  ```
- PostgREST returns HTTP 406 (`PGRST116`) when a `.single()` request matches _zero_ rows or _multiple_ rows. In this case the rows are missing: running
  ```sql
  select item_id
  from public.items
  where item_id in ('I-1767139637044-6xqj','I-1767139637044-d2e0');
  ```
  returns no data, so every fetch logs a 406 before `getItemById` falls back to the offline cache.
- Because the offline cache still has snapshots, the UI continues to show the items, which is why the transaction renders three entries even though Supabase refuses to return them.

## Why the cards are greyed out
- `TransactionDetail` splits items into “current” and “moved” buckets using `splitItemsByMovement`:
  ```19:48:src/utils/transactionMovement.ts
  const transactionMismatch = hasLatestTransaction && item._latestTransactionId !== transactionId
  const explicitMoved = Boolean(item._hasMovedOut)
  const isMoved = explicitMoved || transactionMismatch || transitionalMovedOut
  ```
- Items that were removed from the transaction (or whose latest transaction differs) are pushed into `itemsMovedOut`. That list is rendered with `className="opacity-60"` (`TransactionDetail.tsx:1523`), producing the translucent overlay to signal “read-only / no longer part of this transaction.”
- Net effect: every ghost ID that still lives in `transaction.itemIds` but has no corresponding `items` row shows up under “Moved items,” dimmed and non-interactive.

## Verification + instrumentation
- Supabase query:
  ```sql
  select transaction_id, item_ids
  from public.transactions
  where transaction_id = '9689e160-6232-48da-9bc4-1693201012ea';
  ```
  returns all five IDs, but left-joining those IDs against `public.items` only yields `I-1767139637044-ysp6`, `I-1767159744325-sigc`, and `I-1767159744325-4ay5`. The other two are hard-missing, which reproduces the 406s exactly.
- Trigger health check: inserting a throwaway canonical transaction (`INV_TEST_TRIGGER_001`) and item (`I-TEST-TRIGGER-001`), then deleting the item, successfully removed the ID from `transactions.item_ids` automatically. Conclusion: `remove_deleted_item_ref` is correctly wired today; the Brianhead ghosts pre-date the 2025-12-31 trigger rollout or were deleted outside supported paths (manual SQL, scripts, etc.) and therefore never logged lineage/audit entries.
- There are no rows in `public.item_lineage_edges`, `public.item_audit_logs`, or `public.transaction_audit_logs` for the missing IDs, so the audit system does not reflect the historical removal. Any server-side cleanup must write audit rows explicitly or the Transaction Audit UI will stay silent.

## Next steps
- **Clean the Brianhead transaction now**
  1. Run the orphan detector (same query as above, scoped to this account) and `array_remove` the two ghost IDs from `transaction.item_ids`.
  2. Insert compensating rows into `transaction_audit_logs` describing the removal so the audit trail is accurate.
- **Harden fetch + logging**
  - Swap `.single()` for `.maybeSingle()` (or `.select().limit(1)`) in `getItemById` so missing rows return `null` without PGRST116 spam, while preserving a warning log for visibility.
  - Extend `remove_deleted_item_ref` so if `OLD.transaction_id` is `null` it falls back to `OLD.previous_project_transaction_id`, ensuring server-side scripts that detach before delete still prune `item_ids`.
  - Have `remove_deleted_item_ref` (and the companion insert trigger) write to a lightweight `transaction_audit_logs` helper or new `item_ref_prune_log` table so every array mutation is captured regardless of origin.
- **Add a repair/monitoring job**
  - Nightly job that runs the orphan detector per account/project, prunes dangling IDs with `remove_deleted_item_ref`, and emits telemetry so we can alert if ghosts start accumulating again.
- **Document & test**
  - Update the Transaction Audit testing checklist to assert that removing items via direct SQL or scripts still logs a state change.
  - Backfill this finding with the Supabase queries used above so future regressions have a ready-made runbook.

### Open items
- The final plan must incorporate `item_lineage_edges` so removing an ID from the source transaction, crediting the destination transaction, and recalculating canonical totals happen in one atomic operation (with lineage preserved for the UI).
- Offline queue consumers need a documented way to reconcile pending operations after lineage-driven cleanup, otherwise queued mutations may resurrect ghosts; this flow still needs to be defined.
