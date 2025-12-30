## Needs Review Flag Implementation Plan

**Goal:**
Persist an authoritative `needs_review` boolean on `transactions` that is true whenever the sum of associated items does not match the transaction pre-tax subtotal (i.e., the transaction needs audit review). Keep the existing completeness API for the detailed audit view, but use `needs_review` for fast UI rendering (badges, filtering).

### High-level design
- Add a column `needs_review BOOLEAN NOT NULL DEFAULT false` on the `transactions` table.
- Maintain `needs_review` as the single source of truth for whether a transaction should surface the red badge / be filtered as needing review.
- Compute `needs_review` using the canonical `getTransactionCompleteness`. In the short term the app debounces and enqueues recomputes to reduce duplicate work; the long-term plan is to centralize recompute ownership (single top-level caller) or move the computation to a server-side RPC so the flag is updated once per logical change.
- Update the transactions API / realtime subscription to include `needs_review` so the UI can render the badge without extra per-transaction requests.

### Implementation steps
1. DB migration
   - Add column to `transactions` (no helper/backfill run in-migration):

```sql
ALTER TABLE transactions
  ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false;

-- Optional index if you will query/filter by this flag:
CREATE INDEX idx_transactions_needs_review ON transactions (needs_review);
```

2. Application-level computation (recommended)
   - Keep the canonical completeness logic in `getTransactionCompleteness` and reuse it to derive the boolean decision.
   - When the application mutates items, transactions, or lineage in any flow that could affect completeness, compute `needsReview` and write it to the transaction row in the same flow (so the flag stays current).
   - Example write: use your existing transaction update path (we already map `needsReview` ↔ `needs_review` in the service layer) so the app writes `needs_review` when it updates a transaction's amount, item_ids, or other relevant fields.

3. Call sites to update `needs_review` (typical places):
   - `unifiedItemsService.addItemToTransaction`
   - `unifiedItemsService.removeItemFromTransaction`
   - `unifiedItemsService.createTransactionItems` (on transaction creation)
   - `unifiedItemsService.updateItem` when `transactionId` changes
   - `lineageService.appendItemLineageEdge` (when an item moves in/out)
   - Transaction update/complete flows that change `amount`, `item_ids`, or `subtotal`
   - Item deletion flows

   - NOTE: These lower-level call sites should *not* individually trigger the expensive recompute in future. Prefer a single top-level owner (form/page or orchestration flow) to trigger the recompute once after all related updates complete. See `dev_docs/needs_review_troubleshooting.md` for a PR plan to centralize ownership.

   - Important: compute the boolean using the same code that the audit UI uses (`getTransactionCompleteness`) to avoid divergence.
   - Prefer writing `needs_review` as part of the same application flow that performs the mutation to minimize race windows.

4. Backfill existing transactions (optional)
   - If you want historical rows populated, run a separate backfill script (Node) that iterates transactions and writes `needs_review` using the app's completeness routine. Do not perform a large backfill inside a blocking migration.

5. API / subscription update
   - Include `needs_review` in `transactionService.getTransactions` and in the realtime subscription payload so the client receives it as part of the main transaction list.
   - Because the flag is maintained at mutation time, the realtime payload will remain authoritative for the UI.

6. UI update
   - Update `src/pages/TransactionsList.tsx` to read `transaction.needsReview` (or `needs_review`) and render the red badge immediately. Keep `getTransactionCompleteness` for the detailed `TransactionAudit` view when needed.
   - Example check in React: `transaction.needsReview === true` → show badge.

7. Tests & CI
   - Add tests ensuring application mutation flows recompute and persist `needs_review` correctly.
   - End-to-end test: create a transaction, add items to match subtotal, confirm `needs_review=false`; alter items and confirm `needs_review=true` and UI badge appears immediately.

### Rollout plan
- Deploy migration (adds column only) in a non-production environment.
- Deploy application changes that compute and write `needs_review` in mutation flows.
- Optionally run a backfill script for historical data after application changes are live.
- Monitor for mismatches and add reconciliation job if necessary.

### Monitoring and reconciliation
- Add a periodic reconciliation job that computes completeness for a sample set of transactions and logs or fixes mismatches between the canonical computation and the `needs_review` flag.
- Log every time `needs_review` is flipped (optional) so you can audit changes and diagnose issues.

### Risks & mitigations
- Race conditions: write `needs_review` within the same application flow that changes item linkage or use application-level serialization/queues to reduce race windows.
- Computation bug divergence: reuse the same canonical computation (`getTransactionCompleteness`) and add tests.
- Backfill performance: run optional backfill in batches and throttle to avoid DB load spikes.

### Open questions
- Which variance threshold exactly should map to `needs_review` (e.g., >1% or >20%)? Current `getTransactionCompleteness` uses `variancePercent` bands — confirm which band you want to treat as "needs review".
- Do you prefer additional safeguards like a reconciliation job or audit logging for flips of the flag?

### Current status
 - Short-term mitigations implemented in the app:
   - Added an enqueue/debounce layer (`_enqueueRecomputeNeedsReview`) to coalesce duplicate requests for the same transaction.
   - Increased debounce window to reduce rapid duplicate runs.
   - Converted recompute scheduling to fire-and-forget so mutation flows are not blocked by the expensive calculation.
   - Added lightweight instrumentation to log enqueue requests and callers for diagnosis.
 - Remaining work:
   - Implement single-owner pattern (`startNeedsReviewBatch` / `runNeedsReviewOnce`) in top-level flows to guarantee exactly one recompute per logical change (PR plan drafted in `dev_docs/needs_review_troubleshooting.md`).
   - Optionally move computation to a server-side RPC for best performance and atomicity.

---

If you'd like, I can now:
- Add RPC calls or direct writes in the mutation flows (I already left mapping in the service so writes are possible); or
- Add the optional backfill script (separate file) if you want historical rows populated.

Which next step should I take?
