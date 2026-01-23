---------------------------------------------------------------------------
Title: Canonical Transaction Self-Healing Totals Follow-up Plan
Owner: AI model (implementation agent)
Status: Draft
Last updated: 2026-01-22
Audience: Engineering
Purpose: Align detail + list totals, avoid healing on failed compute, and
         ensure stored totals remain authoritative once repaired.
---------------------------------------------------------------------------

## Context
This follow-up references `CANONICAL_TRANSACTION_SELF_HEALING_TOTALS_PLAN.md`.
The initial implementation computes totals on read, but list views can still
display stale `amount` values if the background repair fails or is delayed.
Also, the compute helper currently returns "0.00" on fetch errors, which can
overwrite valid stored amounts.

## Goals
- Use the same "stored total" behavior in list and detail views.
- Avoid healing (writing `amount`) when compute fails or is incomplete.
- Ensure list UI shows the correct total even before stored repair succeeds.
- Keep price precedence as: project -> purchase -> market.

## Non-Goals
- Schema changes.
- New background job infrastructure (reconciliation stays optional).

## Plan
1) **Make compute failures non-healing**
   - **Decide contract (recommended):** change `computeCanonicalTransactionTotal()` to return
     `Promise<string | null>`.
     - Returns a `"12.34"`-style string (2 decimals) on success.
     - Returns `null` when it cannot confidently compute a total.
   - **Define what is a compute failure (returns `null`):**
     - Transaction row missing / cannot be fetched (when `itemIds` not provided).
     - Items query fails (Supabase error) for the union of `itemIds` + moved-out IDs.
   - **Define what is NOT a compute failure (still returns a number):**
     - Lineage edges fetch fails: treat moved-out set as empty and compute from current items.
     - Empty item set: returns `"0.00"` (this is a valid computed total).
   - **Caller rule:** only attempt healing when computed total is **non-null**.

2) **Introduce a computed total cache for list views**
   - Add a local map state in `TransactionsList` keyed by `transactionId`.
   - When a compute succeeds (non-null), store the computed total in this map and use it
     for display immediately in the list row.
   - Continue to write the computed total to `transactions.amount` in the
     background; once persisted, the local map can be cleared or left as a
     read-through cache.
   - **Lifecycle:** clear the cached entry when the corresponding transaction’s stored `amount`
     matches the computed value (optional), or when transactions are reloaded (acceptable).

3) **Unify display logic between detail and list**
   - Detail already shows computed total immediately; keep that.
   - List should prefer computed total (from the cache) if present, otherwise
     fall back to stored `amount`.
   - This keeps the UI correct even if the heal write is delayed.
   - **Explicit rule:** list amount display uses:
     - `displayAmount = computedTotalByTxId[txId] ?? transaction.amount`

4) **Guard against invalid updates**
   - Only update `amount` if:
     - computed total is non-null
     - computed total differs from stored `amount` (compare as fixed 2-decimal strings)
     - there is a resolved `projectId` for the update path
   - **If `projectId` is missing:** skip healing (do not attempt to pass `''`).
   - No "heal to zero" when compute fails (i.e., when it returns `null`).

5) **Reconciliation hook consistency**
   - Ensure `reconcileCanonicalTransactionTotals()` also skips any transaction
     whose compute fails (returns `null`), and does not write "0.00".
   - **Counters:** return `{ checked, repaired, skipped, errors }` where:
     - `skipped` increments when compute returns `null` (not an error; just not safe to heal)
     - `errors` increments for unexpected exceptions in the reconciliation loop

## Acceptance Criteria
- List and detail views show the same total for canonical transactions.
- UI always shows the correct total (computed or repaired) even if a write
  fails.
- No transaction is healed to "0.00" unless the computed total is actually zero.
- Price precedence remains project -> purchase -> market.

## Test Plan
- Canonical transaction with stale `amount`:
  - List and detail immediately show computed total.
  - Stored `amount` is updated in the background.
- Simulate fetch failure (items unavailable):
  - No update to `amount` occurs.
  - UI continues to show stored `amount`.
- Moved-out items included:
  - Both list and detail totals include lineage-based items.

---------------------------------------------------------------------------
