## Bug: Moved Items section missing on transaction detail

Copy/paste the following prompt into Cursor to take over this fix:

```
I need you to fix the "Moved items" section on `src/pages/TransactionDetail.tsx`.

Context:
- Transaction: `6e4dc742-3ae4-47ba-ad0d-76d6bd808d84`
- Item: `I-1767046392355-avnl`
- Lineage edge exists showing the item moved from the original transaction to `INV_SALE_6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70` (verified via Supabase: see edge `18553737-9655-4e21-8154-fb98b1d4b884`).
- After moving the item, the "Moved items" section is entirely hidden, even though the transaction audit still counts the price.

What's currently broken:
1. The latest code tries to keep all items in a single list with `_hasMovedOut` metadata, but the UI split logic (around lines 1230–1290) now filters incorrectly and returns zero items for the moved list. The new "transaction mismatch" rule causes every item to be treated as moved, so nothing renders in the main list either.
2. Because the UI list ends up empty, the whole "Moved items" section never renders and the transaction looks like it has no items at all.

What I need you to do:
1. Reproduce on `TransactionDetail` for the transaction above (you can query Supabase if needed). Confirm that `items` state contains both the moved item and any active items.
2. Fix the filtering logic so:
   - Active items (current transaction) still show under "Transaction items".
   - Items whose latest transaction ID differs (or `_hasMovedOut === true`) show under "Moved items".
   - **Do not** hide the whole section when only moved items exist; render the header plus list with the faded styling that was already in place.
3. Ensure the Transaction Audit continues to ignore moved items (it should only consider active ones).
4. Add regression coverage if possible (unit test around the filtering helper or integration test for `TransactionDetail`, whichever is fastest).
5. Provide a summary of the root cause (filter logic broke) and how it's now fixed.

Please be precise—this is blocking transaction review for inventory moves.
```

---

## Attempt log

- **2025-12-29 (Attempt 1)**
  - Implemented a helper (`splitItemsByMovement`) to separate active vs. moved items, updated `TransactionDetail` to use it, and added a small regression test.
  - Manual retest on transaction `6e4dc742-3ae4-47ba-ad0d-76d6bd808d84` still shows no "Moved items" section. UI continues to hide the section despite the filtering changes, so the bug remains. Need another pass.

- **2025-12-29 (Attempt 2 - FIXED)**
  - **Root cause identified**: TransactionDetail was not loading moved items at all - they were removed from `transaction.itemIds` when moved, but the page only loaded items from that array. Unlike `getTransactionCompleteness` which includes moved items from lineage edges, TransactionDetail wasn't.
  - **Fix implemented**: Updated TransactionDetail to load moved items from lineage edges (like `getTransactionCompleteness` does) in all code paths: main load, fallback load, business inventory load, and refresh.
  - **Tests added**: Added regression tests for moved items section visibility including edge cases.
  - **Status**: Fixed and tested. The "Moved items" section should now appear when transactions have moved items.