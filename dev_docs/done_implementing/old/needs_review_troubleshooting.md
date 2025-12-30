## Needs Review Flag — Troubleshooting Notes

This document tracks a production/debugging incident where the application recomputed the `needs_review` flag many times during a single small user action, causing slow updates and confusing flag flips.

- **Date:** (add timestamp when reproducing)
- **Reported by:** developer

Symptoms
- A single small change in the UI triggered many `needs_review` recompute executions (observed counts like 19). The UI update took ~15s and the flag flipped multiple times during the operation.
- DevTools console shows collapsed messages with counts (e.g. grey badges "9" and "10"). Those counts indicate repeated identical log messages, not seconds.

What the logs mean
- When the console groups repeated identical messages, the small grey badge shows how many times that exact message happened. Seeing two messages (one reporting `needs_review=true`, one `false`) with badges 9 and 10 means the recompute ran ~19 times and produced those results repeatedly.

Immediate root cause (summary)
- Multiple parts of the code independently scheduled a recompute for the same transaction. Even though the user performed one change, several functions called the recompute path and each call performed a full completeness calculation and DB write.
- The completeness calculation (`getTransactionCompleteness`) is relatively heavy: it reads the transaction, reads all items for the transaction, queries lineage edges, may fetch moved items, then calculates totals and variance. Running that repeatedly is slow.

Fixes applied so far (code changes)
1. Coalescing and dedupe
   - Added `_enqueueRecomputeNeedsReview(accountId, projectId, transactionId)` which coalesces duplicate requests for the same transaction into a single scheduled work item. Duplicate calls share the same Promise or the same timer.
2. Debounce window
   - Increased the debounce window to 1 second to collapse rapid repeated calls into one run.
3. Fire-and-forget scheduling
   - Mutation flows (item create/update/delete, transaction create/update, batch insert of transaction items) now schedule recompute asynchronously and do not await it, so UI updates are not blocked by the completeness calculation.
4. Instrumentation
   - The enqueue function now logs each enqueue with a timestamp and a short caller stack snippet to help trace who requested recompute and how many times.

Observed effect after changes
- The duplicate runs dropped from ~19 to ~3 in a recent reproduce (two quick logs then a final recompute). This is progress but still not perfect; we want a single recompute for a single small action.

Why three calls may still happen
- Multiple code paths can still request recompute: top-level mutation code, item update helper, lineage append, etc. Even with dedupe, ordering and timing can cause multiple scheduled requests if they arrive slightly spaced or if different parts call before dedupe runs.
- Some callers were awaiting recompute previously; converting to fire-and-forget prevents blocking but still leaves scheduling happening from multiple layers.

Next recommended actions (priority order)
1. Guarantee single-recompute per top-level action (recommended short-term)
   - Implement a lightweight `batchMode` API: top-level flows (UI handlers or allocation/deallocation routines) call `beginNeedsReviewBatch()` then perform low-level mutations and finally call `flushNeedsReviewBatch()` to trigger exactly one recompute for the transaction.
   - Make the batch API reentrant with a per-transaction counter and enforce try/finally around begin/flush. Provide `flushNeedsReviewBatch(opts?: { flushImmediately?: boolean })` to bypass debounce after long batched flows.
   - Gate lower-level helpers with `_isBatchActive(accountId, transactionId)` so they do not schedule recompute during an active batch.
2. Trailing-edge single-flight (deterministic burst collapse)
   - Extend the enqueue logic with a per-key `dirty` flag. If enqueued while a run is in-flight, set `dirty=true`. In `finally`, if `dirty`, schedule one trailing run (0–50ms) and clear the flag. This guarantees at most two runs per burst and never misses the latest state.
3. Add a server-side RPC for completeness (medium-term)
   - Move the canonical computation into a database RPC or small backend function. The client schedules the RPC and the DB writes the column; this reduces roundtrips and can be more efficient and atomic.
4. Backfill and monitoring (optional)
   - Run a backfill to set `needs_review` on historical transactions and add a periodic reconciliation job that compares canonical completeness vs flag on a sample of transactions.

Immediate next step for diagnosis
- Reproduce the issue with instrumentation enabled and collect the enqueue debug lines and short stack traces. Paste logs into this document or a ticket. Those logs will show exactly which call sites requested recompute.

Checklist (track progress)
- [x] Add `_recomputeNeedsReview` to compute and persist needs_review
- [x] Hook recompute calls into mutation flows (create/update/delete items and transactions)
- [x] Add `_enqueueRecomputeNeedsReview` to coalesce/debounce concurrent requests
- [x] Make recompute scheduling fire-and-forget so mutations are not blocked
- [x] Add lightweight instrumentation to enqueue for diagnostics
- [ ] Implement `beginNeedsReviewBatch()` / `flushNeedsReviewBatch()` pattern in top-level flows (reentrant, try/finally, optional `flushImmediately`)
- [ ] Add trailing-edge single-flight with `dirty` flag
- [ ] Optionally implement DB/RPC-side completeness calculation
- [ ] Add periodic reconciliation job

Notes
- The immediate coalescing + fire-and-forget changes materially reduce latency and DB load. Implementing `batchMode` (one recompute per top-level action) will provide a deterministic fix for single-change actions and prevent remaining duplicate schedules.

Appendix: quick reproduction checklist
1. Ensure the app is built with the latest changes (instrumentation enabled).
2. Perform the single UI action that previously produced ~19 logs.
3. Copy the console output including the `[needs_review] enqueue requested` lines.
4. Paste the logs into this doc or to the issue ticket for trace analysis.


Latest Logs

All items before processing: (9) [{…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}]
EditTransaction.tsx:288 Separated 9 existing items and 0 new items
2 - inventoryService.ts:657 Recomputed needs_review=true for transaction 74420b2a-a3af-4b08-8122-f1b5e49b442b
2 - inventoryService.ts:657 Recomputed needs_review=false for transaction 74420b2a-a3af-4b08-8122-f1b5e49b442b

Developer commentary (plain language)

- This is a design problem, not just a performance tweak. The system should not let many different parts of the app each decide to run the heavy check when one user action happens.

- What went wrong:
  - Many parts of the code were allowed to independently trigger the expensive `needs_review` recompute. When you saved a single change, several helpers all asked for a recompute and the app ran that heavy calculation multiple times on different intermediate states, causing slow response and flag flips.

- Why debounce/coalescing alone isn't the true fix:
  - Debounce reduces how often the expensive work runs, but it's still a band‑aid. It relies on timing heuristics (how long to wait) and doesn't change the fact that many pieces think they're allowed to trigger the expensive action.

- A better rule (simple):
  - Pick the one place that handles the user's action (the form/page or the high-level function). Make that place the only code that triggers the expensive recompute. Lower-level helpers should never trigger it themselves — they just do their update and return.

- Alternatives and tradeoffs (short):
  - Single-owner (recommended): simple, deterministic, minimal DB load. Refactor so top-level flows call recompute once at the end.
  - Server-side RPC: move the calculation into the backend and call it once per logical change. More work but best UX and server-side control.
  - Debounce/coalesce: quick mitigation while refactoring, but not a permanent fix.

- Recommendation for next step (no code yet):
  - We should identify the top-level flows (e.g. `EditTransaction`, allocation/deallocation) and decide they will be the only callers of the recompute. Then update lower-level code to stop calling recompute. I can write an exact PR plan that lists the files and the single line edits needed so we can review before making changes.

Append the logs above to the ticket along with any extra console output you captured. That will help pinpoint which helpers requested recompute during the flow.

---
 
New discovery: unnecessary item updates during transaction-only edits

- Observation:
  - When editing only transaction-level fields (e.g., subtotal, tax, vendor, date), the submit handler still loops over every “existing” item and calls `updateItem` serially, even when the user did not change any item fields and no new items were added.
  - This produces N item update roundtrips and enqueues recompute(s), causing multi-second saves (observed ~7s with 9 items).

- Evidence (current code path):
  ```296:308:src/pages/EditTransaction.tsx
  console.log(`Separated ${existingItems.length} existing items and ${newItems.length} new items`)
  for (const item of existingItems) {
    await unifiedItemsService.updateItem(currentAccountId, item.id, {
      description: item.description,
      purchasePrice: item.purchasePrice,
      sku: item.sku,
      marketValue: item.marketValue,
      notes: item.notes,
      transactionId: transactionId
    })
  }
  ```

- Why this is a problem:
  - Flipping `needs_review` is based on reading items vs. the transaction subtotal; it does not require mutating items.
  - Touching items when the user did not edit them couples unrelated responsibilities, increases latency, and triggers unnecessary recomputes.

High-level approach to resolve

1. Decouple “pure transaction edit” from item edits:
   - If the user did not change item membership or item fields, do not call any item update APIs at all; update only the `transactions` row.
   - Schedule exactly one recompute for `needs_review` after the transaction save (using the batch API only when other low-level updates are involved).

2. Only touch items when explicitly edited by the user:
   - Item membership changes (add/remove) or item field edits (price, sku, notes) should be the only triggers for item update/create/delete paths.
   - The “create item” path should run only when new items were actually added.

3. Structure the submit flow clearly:
   - For transaction-only edits:
     - Save transaction → enqueue single recompute → return promptly.
   - For edits that include item changes:
     - `beginNeedsReviewBatch(accountId, transactionId)` → perform item changes (prefer batched/parallelized updates) → save transaction if needed → `flushNeedsReviewBatch({ flushImmediately: true })`.

4. Performance and correctness guardrails:
   - Remove unconditional per-item update loops; compute diffs and only issue item updates for changed rows when item edits are present.
   - Keep the trailing-edge single-flight enqueue so late arriving signals coalesce into at most one additional run.
   - Add lightweight metrics: number of items updated vs. changed, total submit duration.

Acceptance for this discovery
- Editing transaction fields without item changes must:
  - Perform zero item update calls,
  - Enqueue at most one recompute,
  - Complete within a snappy latency target (e.g., <200–300ms on a warm connection).

PR plan: exact files and edits (draft)

High-level goal: make the top-level flow(s) the single owner of triggering `needs_review` recompute, and prevent lower-level helpers from scheduling recompute directly.

Files to change (one-line / specific edits)
- `src/services/inventoryService.ts`
  - Add exported functions:
    - `beginNeedsReviewBatch(accountId: string, transactionId: string): void`
      - increments an internal batch counter keyed by accountId:transactionId (reentrant)
    - `flushNeedsReviewBatch(accountId: string, transactionId: string, opts?: { flushImmediately?: boolean }): Promise<void>`
      - decrements the counter and if it reaches zero, calls `_enqueueRecomputeNeedsReview(...)`; when `flushImmediately` is true, bypass debounce
    - ` _isBatchActive(accountId: string, transactionId: string): boolean`
  - Replace direct calls to `_enqueueRecomputeNeedsReview(...)` in helper functions with a guard that only triggers when no batch is active, and do not `await` the enqueue (fire-and-forget):
    - change sites:
      - `unifiedItemsService.createItem` (after insert)
      - `unifiedItemsService.updateItem` (after update)
      - `unifiedItemsService.deleteItem` (after delete)
      - `unifiedItemsService.createTransactionItems` (after batch insert)
      - `transactionService.createTransaction` (after insert)
      - `transactionService.updateTransaction` (after update)
    - Example replacement (conceptual):
      - from: `await transactionService._enqueueRecomputeNeedsReview(accountId, projectId, txId)`
      - to: `if (!this._isBatchActive(accountId, txId)) transactionService._enqueueRecomputeNeedsReview(accountId, projectId, txId)`
  - Must-fix now:
    - Remove the awaited enqueue at the end of `unifiedItemsService.createTransactionItems` and make it fire-and-forget (or rely on `flushNeedsReviewBatch` in the top-level flow).

- Enqueue implementation updates
  - In `transactionService._enqueueRecomputeNeedsReview`:
    - Add `dirty[key]=true` when enqueued during an in-flight run.
    - In `finally`, if `dirty[key]` is true, schedule one trailing run (0–50ms), then clear `dirty[key]`.
    - Retain the single-flight promise/timer behavior and reset `_enqueueCounts` after the final run.

- `src/pages/EditTransaction.tsx`
  - In the submit handler where the page performs multiple item updates and the transaction update:
    - Before starting updates, call: `transactionService.beginNeedsReviewBatch(currentAccountId, transactionId)`
    - After all updates and the transaction update completes, call: `await transactionService.flushNeedsReviewBatch(currentAccountId, transactionId, { flushImmediately: true })`
  - This guarantees a single recompute for the EditTransaction flow.

- Allocation / deallocation top-level flows
  - Files to update (examples):
    - `src/services/inventoryService.ts` functions handling allocation/deallocation entry points (e.g., `allocateItemToProject`, `handleInventoryDesignation`, `ensureSaleTransaction`) — wrap multi-step operations with start/run calls as needed.
    - Any UI pages that perform multi-step allocation flows (identify and wrap similarly).

Instrumentation upgrades
- Emit structured summaries per run key: `enqueue_count`, `started_at`, `finished_at`, `duration_ms`, `was_trailing_run`, `dirty_seen`.
- Keep a compact caller stack only on the first enqueue in a burst; count “skipped due to active batch” occurrences.

Testing and verification
- Unit tests:
  - Multiple helper calls inside an active batch → `_recomputeNeedsReview` is called exactly once.
  - Enqueue during in-flight run → exactly one trailing recompute, then stable final value.
  - Regression: no path `await`s `_enqueueRecomputeNeedsReview`; UI handlers return promptly.
- Manual test:
  - Reproduce the EditTransaction scenario and confirm console shows a single `[needs_review] enqueue requested` and a single DB write for the transaction's `needs_review` column.

Acceptance criteria
- Single small edit → 1 enqueue, 1 recompute, 1 DB write; no UI stall.
- Batched multi-edit flow → 1 recompute (or 2 if a trailing-edge run is triggered), never more.
- Calls during an in-flight recompute → at most one trailing recompute; final `needs_review` matches canonical completeness.
- `TransactionsList` renders badges from `transaction.needsReview` and skips per-row completeness fetch when present.

Rollout plan
- Implement changes behind a feature flag if desired; otherwise coordinate a small deploy and monitor realtime and logs for duplicate enqueues.

Notes
- This PR plan is intentionally surgical: change the minimal set of spots that currently schedule recompute and introduce a small batch counter in the transaction service. I can draft the PR diff text (exact lines) for review before touching code.

