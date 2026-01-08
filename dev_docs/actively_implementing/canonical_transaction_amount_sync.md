# Canonical Transaction Amount Sync — Remediation Plan

## Problem Overview
- **Symptom:** Deleting, inserting, or editing items under canonical inventory transactions (`INV_PURCHASE_*`, `INV_SALE_*`) frequently leaves `transactions.amount` (and `sum_item_purchase_prices`) at `0.00`, even when items exist.
- **Root Causes:**
  - The only database trigger in place (`remove_deleted_item_ref`) runs _after delete_ and was previously applied to every transaction. No triggers exist for insert/update, so canonical totals are never recomputed when items are created or edited.
  - Client-side services call `transactionService.notifyTransactionChanged` with `deltaSum`, but that logic is bypassed for many flows (older data, offline queues, direct SQL migrations, business inventory imports, etc.).
  - Historical canonical rows were never backfilled after the bug zeroed them out.
  - Canonical transactions still rely on `transaction.item_ids` being accurate so recompute jobs know which items to sum. Those arrays currently keep stale IDs when deletes happen outside the canonical triggers, so recomputes can’t tell whether a missing item means “no longer part of this transaction” or “never synced.”

## Remediation Strategy (Best Practices)

1. **Authoritative server-side recompute**
   - Implement a single PL/pgSQL function, e.g. `public.sync_canonical_transaction_amount(p_account_id uuid, p_transaction_id text)`.
   - Behavior:
     - Guard early unless `p_transaction_id` matches canonical prefixes.
     - `SELECT … SUM(coalesce(nullif(project_price,'')::numeric, nullif(purchase_price,'')::numeric, 0))` from `public.items`.
     - `UPDATE public.transactions SET amount = formatted_sum, sum_item_purchase_prices = formatted_sum, updated_at = now()`.
     - Run inside a transaction; keep the function idempotent and fast (single update).

2. **Attach triggers for _all_ item mutations**
   - `AFTER INSERT ON public.items FOR EACH ROW` → `PERFORM sync_canonical_transaction_amount(NEW.account_id, NEW.transaction_id)`.
   - `AFTER UPDATE` → only when `OLD.transaction_id IS DISTINCT FROM NEW.transaction_id OR price fields changed`; ensure both the old and new transaction IDs are synced (to subtract/add).
   - `AFTER DELETE` → replace the current `remove_deleted_item_ref` logic with a call to the new function, plus the existing `item_ids` cleanup.
   - Keep the trigger functions `SECURITY DEFINER` with `search_path = public` and minimal logic; reuse helper functions where possible.

3. **Maintain transaction `item_ids` arrays**
   - Preserve the existing `array_remove/array_append` maintenance inside dedicated helper functions so `TransactionDetail` never loads orphaned IDs.
   - Ensure the recompute trigger runs _after_ the array has been updated so sums reflect the new state.

4. **One-time backfill for canonical rows**
   - Write a migration (idempotent) that recomputes `amount` + `sum_item_purchase_prices` for every transaction with an `INV_%` ID:
     ```sql
     update public.transactions t
     set amount = formatted_sum,
         sum_item_purchase_prices = formatted_sum,
         updated_at = timezone('utc', now())
     from (
       select
         account_id,
         transaction_id,
         to_char(
           coalesce(sum(coalesce(nullif(project_price,'')::numeric, nullif(purchase_price,'')::numeric, 0)), 0),
           'FM9999999999990.00'
         ) as formatted_sum
       from public.items
       where transaction_id like 'INV_%'
       group by account_id, transaction_id
     ) s
     where t.account_id = s.account_id
       and t.transaction_id = s.transaction_id;
     ```
   - Include rows with zero items so they get `0.00`.

5. **Tighten app-layer behavior**
   - Continue calling `notifyTransactionChanged` for non-canonical transactions (user-entered amounts).
   - For canonical IDs, skip client-side deltas once the DB triggers are live to avoid double updates.
   - Add regression tests (unit + integration) that:
     - Create a canonical transaction with items → ensure amount auto-matches.
     - Delete/edit items → ensure amount updates accordingly.
     - Verify non-canonical transactions retain manual amounts despite item churn.

6. **Monitoring & Observability**
   - Add lightweight logging inside the new trigger function (using `RAISE LOG`) for unexpected NULL sums or missing transactions.
   - Consider a nightly job that scans canonical transactions for mismatches between `amount` and the item sum, raising an alert if any drift is detected.

7. **Keep canonical `item_ids` authoritative**
   - Whenever canonical transactions are recomputed (via trigger or backfill job), validate that each ID still exists in `public.items`. If a row is missing, remove that ID from `transaction.item_ids` before summing and log it so cache hygiene can be addressed separately.
   - If recompute encounters duplicate rows for the same `item_id`, raise an alert before applying the sum; canonical totals should reflect the deduped set, not double-counted entries.

## Deliverables
1. `supabase/migrations/2026xxxx_sync_canonical_transaction_amounts.sql`
   - Defines `sync_canonical_transaction_amount`.
   - Creates/updates triggers for INSERT/UPDATE/DELETE on `public.items`.
   - Keeps `remove_deleted_item_ref` (or merges logic) for array maintenance.
2. `supabase/migrations/2026xxxx_backfill_canonical_amounts.sql`
   - One-time recompute for existing canonical transactions.
3. App-layer change set
   - Guard `transactionService.notifyTransactionChanged` so canonical IDs skip `deltaSum`.
   - Add tests covering canonical vs. non-canonical behavior.

Following this plan ensures canonical inventory transactions are always self-consistent—no more manual recalcs, no more zeroed amounts after deletes, and user-entered transactions remain untouched.
