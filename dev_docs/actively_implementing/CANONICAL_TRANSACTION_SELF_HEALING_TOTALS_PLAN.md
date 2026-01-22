---------------------------------------------------------------------------
Title: Canonical Transaction Self-Healing Totals Plan
Owner: AI model (implementation agent)
Status: Draft
Last updated: 2026-01-22
Audience: Engineering
Purpose: Ensure canonical transaction totals stay correct by validating on read and repairing drift.
---------------------------------------------------------------------------

## Goals
- Keep `transactions.amount` accurate for canonical IDs without relying on perfect write paths.
- Maintain immediate UI correctness (show computed total even if stored amount is stale).
- Provide a low-latency repair path that updates stored totals opportunistically.
- Preserve moved-out items visibility (lineage edges remain the source for moved items).

## Non-Goals
- Full schema redesign or migration to Firebase (design remains migration-friendly).
- Changing how moved-out items are displayed in `TransactionDetail`.

## Summary of Approach
Add a read-time validation step for canonical transactions:
1) Compute total from associated items (including moved-out via lineage edges).
2) Compare with stored `transactions.amount`.
3) Return the computed total immediately.
4) If mismatch, update `transactions.amount` in the background ("self-heal").

## Implementation Steps
1) **Create a canonical total computation helper**
   - Single utility in `inventoryService` or `transactionService` for reuse.
   - Inputs: accountId, transactionId, itemIds (optional), lineage edges (optional).
   - Output: computed total as string with fixed 2 decimals.

2) **Integrate with Transaction Detail load path**
   - When loading a canonical transaction, compute total using:
     - `transaction.item_ids` (current items)
     - lineage edges for moved-out items when needed
   - Display computed total.
   - If computed total differs from stored `amount`, schedule background update.

3) **Integrate with list/report/budget paths**
   - For canonical transactions in list/report views, compute totals in batch:
     - Fetch items for the displayed transactions.
     - For performance, compute only when canonical and when totals are visible.
   - If drift is detected, batch update amounts asynchronously.

4) **Add a reconciliation hook (optional safety net)**
   - A periodic job or on-demand admin action that recomputes all canonical totals.
   - This is a backstop for missed reads.

## Code Areas to Touch (likely)
- `src/services/inventoryService.ts` (canonical total helper, reuse existing item price logic)
- `src/pages/TransactionDetail.tsx` (use computed total, trigger self-heal update)
- `src/pages/TransactionsList.tsx` or reporting/budgeting queries (batch compute + heal)
- `src/services/lineageService.ts` (fetch edges when moved-out totals are needed)

## Correctness Rules
- Canonical totals should include items that are moved out via lineage edges.
- UI should always show computed totals; stored totals are treated as cached values.
- Updates to `transactions.amount` must be idempotent and safe under concurrency.

## Performance Considerations
- Prefer batched item fetches when computing totals for lists.
- Cache computed totals within a short TTL if needed.
- Only compute for canonical transaction IDs.

## Risks
- Additional reads for items/edges on transaction list pages.
- Background updates may conflict with concurrent writes; treat as last-write-wins.

## Test Plan
- Scenario: Project → Project sale (moved-out items included in total).
- Scenario: Purchase → Return (moved-out items included in total).
- Scenario: Transaction with stale amount shows computed total and repairs stored amount.
- Regression: Moved-out items still show in Transaction Detail.
---------------------------------------------------------------------------#
