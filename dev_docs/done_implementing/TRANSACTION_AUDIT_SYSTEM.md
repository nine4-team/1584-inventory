# Transaction Audit System

This document describes how the application's Transaction Audit System works, the role of the `needs_review` flag, and the supporting infrastructure we added to make auditing efficient and deterministic.

This is an operational reference for engineers working on transaction flows, item lineage, and audit automation.

## Goals

- Provide a single canonical place to decide whether a transaction needs human review.
- Avoid repeated heavy recomputation during a single user action.
- Keep audit decisions reproducible and observable.
- Allow efficient backfills and safe rollouts.

## Key concepts

- Transaction: the canonical record in `public.transactions` (identified by `transaction_id`).
- Items: records in `public.items` associated to a transaction via `transaction_id`.
- Needs Review flag (`transactions.needs_review`): a denormalized boolean persisted on the transaction row that indicates whether the transaction requires human audit.
- Derived sum (`transactions.sum_item_purchase_prices`): a persisted numeric column holding the sum of item purchase prices for the transaction; used to make the `needs_review` decision cheaper and more stable.
- Recompute pipeline: the set of functions that calculate canonical completeness/variance and persist the `needs_review` column.
- Notification API (`transactionService.notifyTransactionChanged`): centralized entry point to record changes that may affect `needs_review` and to schedule recomputation.

## How `needs_review` is computed

1. The canonical computation reads:
   - The transaction row (subtotal, tax, other transaction-level fields).
   - All items that are logically part of the transaction (including items moved out via lineage edges when relevant).
2. It computes:
   - Item net total (sum of purchase prices).
   - Items count, missing price counts, subtotal vs items net total variance (dollar & percent).
   - Any other business rules that should cause review (e.g., negative totals, large variance thresholds, missing receipts).
3. Based on configured thresholds and rules, the computation returns the boolean `needsReview`.
4. The service persists `transactions.needs_review` (and optionally writes other diagnostic columns).

Notes:
- Because reading items and lineage edges is relatively expensive, we introduced `sum_item_purchase_prices` to avoid re-summing many rows constantly for simple checks.
- The computation remains authoritative (server-side); persisted columns are optimizations and must be recomputed periodically or on-demand when data changes.

## Persisted derived column: `sum_item_purchase_prices`

- Purpose: persist the sum of item purchase prices for the transaction to make `needs_review` checks cheaper and more consistent.
- Schema:
  - `transactions.sum_item_purchase_prices numeric(12,2) not null default 0`
- Backfill: A backfill script is provided to populate existing transactions from current `items` rows.

Why persisted?
- Avoids repeated scanning and summing of item rows when a transaction-level change happens (e.g., updating subtotal).
- Makes `needs_review` computation faster and more predictable.

Atomicity note:
- Current implementation provides a read-then-write helper as a fallback for environments without DB RPCs.
- For correctness under concurrent writers, we strongly recommend replacing the read-then-write with a DB-side RPC that performs an atomic increment (recommended migration & function provided in future work).

## Change flow & centralization

To guarantee predictable recomputes and avoid duplicate heavy runs, all code paths that can affect `needs_review` should call a single centralized API:

- transactionService.notifyTransactionChanged(accountId, transactionId, { deltaSum?, flushImmediately? })

Responsibilities of `notifyTransactionChanged`:

- If `deltaSum` is given, update the persisted `sum_item_purchase_prices` by that delta (atomic RPC preferred).
- Schedule a recompute of `needs_review`. This is done using the existing enqueue/coalescing mechanism (`_enqueueRecomputeNeedsReview`) which dedupes and debounces requests.
- Optionally bypass debounce (`flushImmediately`) for top-level batched flows when needed.

Where this API is used:
- Item operations (`createItem`, `updateItem`, `deleteItem`) — call with `deltaSum` equal to the change in purchase price for the affected transaction(s).
- Batch item inserts (`createTransactionItems`) — call once with the sum delta for all inserted items.
- Top-level flows (e.g., EditTransaction submit):
  - Use the batch API (`beginNeedsReviewBatch` / `flushNeedsReviewBatch`) to group multiple low-level operations and trigger a single recompute at the end.

## Coalescing & batch pattern

- _Enqueue_ (`_enqueueRecomputeNeedsReview`) coalesces duplicate requests for the same transaction and debounces them (1s default) to reduce burst recomputations.
- Batch API (recommended pattern):
  - `beginNeedsReviewBatch(accountId, transactionId)` increments a per-transaction in-flight counter to prevent lower-level helpers from scheduling recompute.
  - Perform low-level changes (items creates/updates/deletes).
  - `flushNeedsReviewBatch(accountId, transactionId, { flushImmediately?: boolean })` decrements the counter and, when no more callers are active, triggers a single recompute (optionally immediate).
- Lower-level helpers should check `_isBatchActive(accountId, transactionId)` and avoid scheduling recomputes if a batch is active.

This pattern guarantees at most one recompute per top-level user action (ideal) and allows lower-level code to remain simple.

## Implementation details (current)

- Converters:
  - DB → app: `sum_item_purchase_prices` is mapped to `Transaction.sumItemPurchasePrices` as a string (two-decimal representation).
  - App → DB: the same field is written when provided on transaction updates.

- Helpers:
  - `_adjustSumItemPurchasePrices(accountId, transactionId, delta)` — read-then-write helper that applies a numeric delta to the persisted sum. Use with caution under concurrency.
  - `transactionService.adjustSumItemPurchasePrices(...)` — exported wrapper.
  - `transactionService.notifyTransactionChanged(...)` — exported centralized entry point that optionally calls the adjust helper and enqueues recompute.

- Item flows changed:
  - `createItem`, `updateItem`, `deleteItem`, and batch insertion routines now call `notifyTransactionChanged` with the appropriate `deltaSum` instead of directly scheduling `_enqueueRecomputeNeedsReview`.

## Backfill & rollout

Steps for rollout:

1. Add DB migration to add `sum_item_purchase_prices` (done).
2. Deploy code that reads/writes the new column and uses `notifyTransactionChanged` (done behind feature flag or in safe deploy).
3. Run backfill script to populate existing transaction rows from current item data.
4. Monitor logs for duplicate recomputes and mismatches between canonical completeness and persisted `needs_review`.
5. If needed, create reconciliation job to compare canonical computation vs persisted flag on a sample and correct discrepancies.

Rollback considerations:
- The new column and helpers are additive; if an issue appears, stop calling `notifyTransactionChanged` and revert to recomputing from item scans (temporary).

## Testing & verification

- Unit tests:
  - Validate delta application for single item create/update/delete.
  - Validate that batch inserts produce a single delta and a single enqueue.
  - Validate that moving an item between transactions subtracts from the old transaction and adds to the new.

- Integration tests:
  - End-to-end flows for `EditTransaction` with unchanged items (should not touch items).
  - Batched flows ensure only one recompute is scheduled and `needs_review` final state matches canonical computation.

- Manual checks:
  - After backfill, run spot checks comparing `sum_item_purchase_prices` to the sum of `items.purchase_price` for the transaction.
  - Watch logs for `[needs_review] enqueue requested` lines and confirm counts fall to expected values.

## Monitoring & instrumentation

- Instrument `enqueue` lines with: key, caller hint, timestamp, and whether a trailing run was scheduled.
- Emit metrics:
  - Enqueues per transaction per minute
  - Recomputes per user action
  - Average recompute duration
  - Mismatch rate between canonical computation and persisted flag (sampled)

## Known caveats & future work

- Atomic increments: move `_adjustSumItemPurchasePrices` to a DB RPC for safe concurrency.
- Consider colocating the canonical computation as a DB RPC for stronger server-side guarantees and fewer client round trips.
- Add a periodic reconciliation job to correct drift and detect bugs early.
- Expand tests to cover high-concurrency scenarios.

### Optional future improvement — DB RPC for atomic increments

As an optional (but recommended) improvement, implement a database-side RPC/function to perform atomic increments of the derived sum. Example pattern:

- Create a SQL function (example Postgres signature):
  - `create function increment_sum_item_purchase_prices(p_account_id uuid, p_transaction_id uuid, p_delta numeric) returns numeric as $$ ... $$ language plpgsql;`
- The function should perform the increment in a single statement (e.g., `update transactions set sum_item_purchase_prices = sum_item_purchase_prices + p_delta where account_id = p_account_id and transaction_id = p_transaction_id returning sum_item_purchase_prices;`) and return the new value.
- Expose the function via Supabase `rpc` and call it from the app: `supabase.rpc('increment_sum_item_purchase_prices', { p_account_id: ..., p_transaction_id: ..., p_delta: ... })`.

Benefits:
- Atomicity under concurrent writes (no lost updates).
- Fewer round trips and simpler client logic.
- Easier to enforce permissions and validations inside the DB function.

Migration note:
- Add a migration that creates the SQL function and appropriate grants. Update `transactionService` to call the RPC when available and fall back to the read-then-write helper otherwise.

## Contacts / owners

- Primary: Inventory/Transactions service owner (see README for team assignments)
- Secondary: Platform/DB owner for RPC implementation and migrations

## References

- Migrations:
  - `supabase/migrations/20251110_add_sum_item_purchase_prices.sql`
  - `supabase/migrations/20251110_backfill_sum_item_purchase_prices.sql`
- Implementation notes:
  - `src/services/inventoryService.ts` (conversion, adjust helper, notifyTransactionChanged)
  - `src/types/index.ts` (Transaction.sumItemPurchasePrices)
  - `dev_docs/needs_review_troubleshooting.md`

---END


