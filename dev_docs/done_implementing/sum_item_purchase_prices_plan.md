# Centralizing `needs_review` With `sumItemPurchasePrices`

This plan walks through the work required to make the transaction record the single owner of the `needs_review` flag by maintaining a derived column named `sumItemPurchasePrices`. It is written for a junior developer; every section includes concrete file paths, example snippets, and explicit validation steps.

---

## 1. Background Context

- Today, many helper functions independently call `_enqueueRecomputeNeedsReview`. That scatters responsibility across the codebase and causes duplicate recomputes.
- We already have batching/debouncing, but that is a band-aid. We want **one canonical place** that decides when the recompute runs.
- The invariant we will maintain is the sum of purchase prices for every item linked to a transaction. When that sum changes, we compare it to the transaction’s `amount` and decide whether `needs_review` should flip.

---

## 2. High-Level Goals

1. Add a persisted column `sum_item_purchase_prices` to the `transactions` table (maps to React-side `sumItemPurchasePrices`).
2. Guarantee that **only** the transaction layer updates that column and triggers the `needs_review` recompute.
3. Stop item helpers (`createItem`, `updateItem`, `deleteItem`, allocation flows, etc.) from calling `_enqueueRecomputeNeedsReview` directly.
4. Leave instrumentation/logging in place so we can prove we now get one recompute per logical change.

---

## 3. Implementation Phases

### Phase A — Schema + Types

1. **Migration:** create a Supabase migration under `supabase/migrations/` named `YYYYMMDDHHMM_add_sum_item_purchase_prices.sql`.
   ```sql
   alter table public.transactions
     add column if not exists sum_item_purchase_prices numeric(12,2) not null default 0;

   create index if not exists idx_transactions_sum_item_purchase_prices
     on public.transactions (sum_item_purchase_prices);
   ```
   - Use numeric to match other currency fields in the table.
   - Default to `0` to keep existing rows valid.
2. **Type update:** in `src/types/index.ts` add `sumItemPurchasePrices?: string;` to the `Transaction` interface and any related form types.
3. **DB ↔ app converters:** update `_convertTransactionFromDb` and `_convertTransactionToDb` inside `src/services/inventoryService.ts` to map the new column.

### Phase B — Backfill Existing Data

1. Create a one-off SQL script in `supabase/migrations/` (or a `supabase/functions/sql/` script if preferred) that:
   ```sql
   update public.transactions t
   set sum_item_purchase_prices = coalesce((
     select sum(coalesce(i.purchase_price, '0')::numeric)
     from public.items i
     where i.account_id = t.account_id
       and i.transaction_id = t.transaction_id
   ), 0);
   ```
2. Run it locally against the development database (`supabase db reset` + `supabase db push`) and confirm a few rows with `select transaction_id, amount, sum_item_purchase_prices from public.transactions limit 5;`.
3. Document how to backfill in staging/production (either re-run the SQL or write a tiny script using Supabase admin API).

### Phase C — Centralized Update Helpers

1. **Create a service method:** add `transactionService._adjustSumItemPurchasePrices` in `src/services/inventoryService.ts`.
   - Inputs: `accountId`, `transactionId`, delta as a `string` or `number`.
   - Behavior: runs a single SQL update to add the delta to `sum_item_purchase_prices` (handle positive/negative).
   - Returns the new sum so the caller can log it.
2. **Wrap Supabase calls:** use `supabase.rpc('increment_transaction_sum', ...)` if you prefer a Postgres function with atomic updates. If not using RPC, ensure the update happens inside a Supabase transaction (`supabase.from('transactions').update(...)`) with `increment`.
3. **Derived recompute:** add `_recomputeNeedsReviewFromDerivedData(accountId, transactionId)` that:
   - Reads the transaction (including `amount` and `sum_item_purchase_prices`).
   - Runs the completeness logic once.
   - Writes the result to `needs_review`.
   - Logs inputs/outputs for diagnostics.
4. **Single entry point:** export a helper `transactionService.notifyTransactionChanged(accountId, transactionId, opts)` that:
   - Updates the derived sum (if `opts.deltaSum` present).
   - Updates other optional derived fields (future-proofing).
   - Calls `_enqueueRecomputeNeedsReview`.

### Phase D — Update Item Flows

For each of these, remove direct recompute calls and instead call the new helper with a delta.

| Flow | File | Change |
| --- | --- | --- |
| Item create | `src/services/inventoryService.ts` `createItem` | After insert, compute its purchase price, call `notifyTransactionChanged(..., { deltaSum: +purchasePrice })`. |
| Item update | same file, `updateItem` | If purchase price changes, compute difference (`new - old`) and pass as delta. If item moves between transactions, subtract from old transaction and add to new. |
| Item delete | same file, `deleteItem` | Subtract the old purchase price from the transaction sum. |
| Batch allocation + other inventory flows | various functions in `transactionService`, `allocationService`, etc. | When items move between transactions, adjust both old and new transaction sums accordingly. |

Implementation tips:
- Always wrap multi-item operations (`batchAllocateItemsToProject`, `createTransactionItems`, etc.) with `beginNeedsReviewBatch` / `flushNeedsReviewBatch`.
- Use `try/finally` to guarantee the flush even when an error occurs.
- Add explicit comments `// No direct _enqueueRecomputeNeedsReview here; notifyTransactionChanged handles it.` so future readers do not reintroduce the bug.

### Phase E — Remove Legacy Calls

1. Search for `_enqueueRecomputeNeedsReview` across `src/`.
2. For each call:
   - If the call now goes through `notifyTransactionChanged`, delete the old direct call.
   - If it is part of a UI flow that should trigger recompute (e.g., editing the transaction amount), ensure it still calls `notifyTransactionChanged` with `deltaSum = 0` (no sum change but we still recompute).
3. Update the docs (`dev_docs/needs_review_troubleshooting.md`) to reflect the new architecture.

---

## 4. Testing Strategy

### Unit Tests (Vitest/Jest)

- New tests for the derived helper: confirm that positive and negative deltas update the stored sum as strings (two decimals).
- Update existing tests for `transactionService.updateItem` and `createItem` to assert that they call `notifyTransactionChanged` with the correct delta.
- Add a regression test: multiple `updateItem` calls within a batch result in only one `_enqueueRecomputeNeedsReview` invocation.

### Manual QA

1. **Baseline sanity:** create a transaction with items, run the app, confirm the edit form shows matching totals.
2. **Item price change:** edit an item’s purchase price; inspect the database row to ensure `sum_item_purchase_prices` changed as expected.
3. **Item delete:** delete an item; confirm the sum decreased and `needs_review` recomputed once (check logs).
4. **Multi-item allocation:** allocate several items to a project; confirm a single recompute occurs and the sum matches the items now attached to the transaction.

### Observability

- Enhance the existing instrumentation under `_enqueueRecomputeNeedsReview` to log the new sum and the delta that triggered the recompute.
- Optional: emit metrics (count of recomputes, count of skipped delta updates) if we have a monitoring stack.

---

## 5. Rollout & Migration Notes

1. Run the schema migration in staging.
2. Execute the backfill script and spot check.
3. Deploy the code changes that write to `sum_item_purchase_prices`.
4. Monitor logs for duplicate enqueues or unexpected deltas (keep console warnings in place for a week).
5. After confidence, clean up any TODO comments and close the follow-up task in `dev_docs/needs_review_troubleshooting.md`.

---

## 6. FAQ / Gotchas

- **Why keep the sum on the transaction instead of recalculating every time?** It lets us trigger recompute deterministically and keeps expensive aggregate queries out of the hot path.
- **What if purchase prices are null or empty strings?** Always coalesce to `'0.00'` before converting to numeric, both in the SQL backfill and runtime adjustments.
- **What about tax updates or other fields that affect completeness?** Add them to `notifyTransactionChanged` later; for now the focus is on item purchase totals.
- **Do we still need batching?** Yes. Batching ensures that flows performing many item mutations still collapse recompute calls while the derived sum updates once per batch.

---

## 7. Next Steps Checklist

- [ ] Create migration + run locally.
- [ ] Update types and converters.
- [ ] Implement `notifyTransactionChanged` + delta helpers.
- [ ] Refactor item flows to use the new helper.
- [ ] Remove direct `_enqueueRecomputeNeedsReview` calls floating around.
- [ ] Add tests (unit + manual).
- [ ] Update docs and confirm instrumentation.

If anything here feels unclear, grab a senior dev before coding. The work touches both database schema and business-critical flows, so double check every delta calculation and keep console logging verbose until we prove the new architecture in staging.

---

_Ping @maintainer if you need a walkthrough or pairing session; it is better to slow down than to reintroduce recompute spam._

