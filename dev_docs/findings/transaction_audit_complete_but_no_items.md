# Transaction Audit shows “Complete” but no items are visible

## Summary

We found a specific case where the **Transaction Audit** (completeness tracker) shows **“Complete”** even though the **transaction page shows zero items**.

This is caused by **state drift** between two different ways the system represents “items belonging to a transaction”:

- **Authoritative link**: `items.transaction_id` (an item is currently attached to a transaction)
- **Cached/reference list**: `transactions.item_ids` (a list of item IDs “associated” with a transaction)

In this incident, `transactions.item_ids` says the transaction has an item, but the item is actually attached (via `items.transaction_id`) to a *different* transaction. The audit uses `transactions.item_ids`, so it can look “Complete” while the transaction’s visible items list (depending on fetch path) shows none.

---

## The incident (concrete IDs and what we saw)

URL (transaction detail):

- `76dbc4f0-358e-4bc3-a149-628605e00c45` (project `0ee567e7-ae7b-4816-910f-2296368a6e60`)

### What’s in `transactions`

For transaction `76dbc4f0-…`:

- `transactions.item_ids = ["I-1768244259678-edxc"]`
- `amount = "85.39"`
- `subtotal = "79.99"`
- `needs_review = false`

There is also another Homegoods transaction:

- `ff3e28fe-1db2-4601-8a4b-5db6ae7cd92a`
- It also has `transactions.item_ids = ["I-1768244259678-edxc"]`

### What’s in `items`

For item `I-1768244259678-edxc`:

- `items.transaction_id = "ff3e28fe-1db2-4601-8a4b-5db6ae7cd92a"`
- `items.latest_transaction_id = null`
- `items.previous_project_transaction_id = null`

Counts that highlight the mismatch:

- `count(items where transaction_id = "76dbc4f0-…") = 0`
- `count(items where transaction_id = "ff3e28fe-…") = 1`

### What’s in transaction audit logs

In `transaction_audit_logs`, we have entries showing that `add_transaction_item_ref` ran for this item, and it ran for **both** transactions (two “added” events).

That matches the “stuck reference” pattern: item ID gets appended into multiple `transactions.item_ids` arrays over time.

---

## Why the UI shows “Complete” even with no visible items

### The audit/completeness computation prefers `transaction.itemIds`

In `src/services/inventoryService.ts`, `transactionService.getTransactionCompleteness()` intentionally prefers the transaction’s stored `itemIds` (from `transactions.item_ids`) over querying by `items.transaction_id`. This was designed so that “moved out” items can still be included (and the audit doesn’t go blank after a move).

So if `transactions.item_ids` is stale/incorrect, the audit can still count items that are not currently attached to the transaction.

### The items list can legitimately show none

The transaction detail page (`src/pages/TransactionDetail.tsx`) loads items via:

- `transaction.itemIds` when present, otherwise
- a query via `unifiedItemsService.getItemsForTransaction(...)` which is (ultimately) `items where transaction_id = <tx>`

If the page’s item-loading path ends up effectively relying on `items.transaction_id` for “in transaction” display (or if reconciliation/hydration returns none for this tx), it can show zero items.

In this incident, **there are truly zero items currently attached** to `76dbc4f0-…` via `items.transaction_id`, so “no items visible” is consistent with the database state.

---

## Root cause: DB trigger appends refs but doesn’t remove old refs on moves

The main mechanism that creates the drift is the database trigger added in:

- `supabase/migrations/20260107_sync_canonical_transaction_amounts.sql`

That migration defines:

- `trg_items_after_update_sync_item_refs`
- `handle_item_update_sync_transaction_refs()`

When an item’s `transaction_id` changes:

- If `NEW.transaction_id` is not null, it calls:
  - `public.add_transaction_item_ref(NEW.account_id, NEW.transaction_id, NEW.item_id)`
- It **does not remove** the item id from `OLD.transaction_id` (unless the item row is deleted entirely, or other specialized cleanup paths run).

Result:

- Item moves `A → B`
- `B.item_ids` gets the item appended
- `A.item_ids` keeps the old entry
- Over time, multiple transactions can claim the same item in `item_ids`

That exact pattern is what we saw here.

---

## Secondary contributor: application code path that links items without setting lineage pointers

There is also an application-level helper:

- `unifiedItemsService.addItemToTransaction(...)` in `src/services/inventoryService.ts`

In the “transaction exists” path, it contains:

- It updates `transactions.item_ids` directly (Supabase update)
- Then it does:
  - `updateItem(accountId, itemId, { transactionId: transactionId })`

This updates `items.transaction_id` but does **not** set `latestTransactionId` or lineage edges.

That matches what we see on the incident item (`latest_transaction_id` is `NULL`, and there are no `item_lineage_edges` rows).

This isn’t necessarily “wrong”, but it means we rely more heavily on the fragile `transactions.item_ids` cache to infer history, which makes drift more damaging.

---

## How to clean up this specific incident

For transaction `76dbc4f0-…`, pick the intended truth:

- If it should have **no items**:
  - Remove `I-1768244259678-edxc` from `transactions.item_ids` for `76dbc4f0-…`
- If it should actually own the item:
  - Update the item to point at it (and consider creating a lineage edge / setting latest pointers)

Also consider cleaning duplicates:

- The system currently has two Homegoods transactions with the same amount and both claiming the same item via `item_ids`.

---

## How to prevent recurrence (recommended)

### Option 1 (recommended): fix the trigger to remove refs on moves

Change the “after update” trigger function so that when `transaction_id` changes:

- Remove the item id from `OLD.transaction_id` (if old is not null)
- Add the item id to `NEW.transaction_id` (if new is not null)

This makes `transactions.item_ids` reflect “current attachment”, not “historical association”.

If the product needs “moved out” history, store that history in:

- `item_lineage_edges`, and/or
- `latest_transaction_id` / `previous_project_transaction_id`

### Option 2: stop using `transactions.item_ids` for non-canonical transactions

If the purpose of `item_ids` is mostly canonical-transaction amount sync and some reconciliation, constrain its usage:

- Canonical transactions: OK to keep in sync via DB triggers
- Non-canonical: compute items from `items.transaction_id`, and for moved-out history rely on lineage

### Option 3: harden UI/audit logic against stale `item_ids`

When building “items in this transaction”:

- Treat `transactions.item_ids` as “candidates”, but only count/display items that are either:
  - currently attached (`items.transaction_id = tx`), or
  - have a lineage edge involving this transaction (moved out)

This reduces “ghost completeness”.

---

## Quick mental model (plain English)

- The system currently has **two ledgers** that can say which items belong to a transaction.
- One ledger (`items.transaction_id`) is the “real link”.
- The other ledger (`transactions.item_ids`) is a “sticky list” that can accumulate entries over time.
- The audit uses the sticky list, so it can look good even when the real link says “no items here”.

