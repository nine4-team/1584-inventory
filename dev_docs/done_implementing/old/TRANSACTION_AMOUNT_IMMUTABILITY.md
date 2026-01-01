# Transaction Amount Immutability Fix

## Summary

The `transactions.amount` column is intended to reflect the user-entered total for every non-canonical transaction. Only system-generated canonical transactions (`INV_PURCHASE_*`, `INV_SALE_*` and similar auto-ledger rows) are allowed to derive their amount from associated item prices. Currently, helper flows that add or remove items from *any* transaction recompute this column, which overwrites user data.

## Current Behavior

1. Users enter the amount when creating or editing a transaction via the standard forms (`inventoryService.createTransaction` / `inventoryService.updateTransaction`).
2. Any later call to `unifiedItemsService.addItemToTransaction` or `unifiedItemsService.removeItemFromTransaction`:
   - Loads the transaction’s `item_ids`.
   - Queries each item’s `project_price` / `market_value`.
   - Recalculates the total and writes it back to `transactions.amount`, regardless of the transaction type.
3. These helpers are invoked by:
   - Transaction Audit UI when a user accepts suggested items.
   - Inventory allocation/return workflows (batch allocate, return, canonical transitions).
   - Any other item reassignment that funnels through the same helpers.

Because there is no guard for canonical IDs, every non-canonical transaction that goes through these paths loses its user-entered amount.

## Impact

- User-entered totals are silently overwritten whenever items are managed via audit or allocation flows.
- Financial reports, budget progress, and downstream calculations that rely on the stored amount are now inconsistent with what the user entered.
- There is no audit trail capturing the previous amount, so historical data might already be corrupted.

## Goals

1. Ensure `transactions.amount` stays immutable for all non-canonical transactions after initial create/edit.
2. Preserve dynamic recalculation only for canonical system transactions.
3. Prevent future regressions with explicit test coverage.
4. Provide a migration or repair strategy (separate effort) once behavior is fixed.

## Proposed Fix

1. **Introduce canonical detection helper**
   - Utility that returns `true` only for canonical transaction IDs (prefix match on `INV_PURCHASE_`, `INV_SALE_`, `INV_TRANSFER_` as needed).
   - Co-locate in `inventoryService` (or shared `transactions` util) for reuse.

2. **Guard helper mutations**
   - Update both `addItemToTransaction` and `removeItemFromTransaction` to:
     - Skip recalculating `amount` unless the transaction is canonical.
     - Still maintain `item_ids` linkage for non-canonical transactions without touching the amount column.
   - Provide explicit logging when a non-canonical transaction attempts to trigger a recalculation (useful for diagnostics).

3. **Transaction Audit UI**
   - Keep the ability to attach items, but never expect the stored `amount` to change for non-canonical IDs.
   - If the UI needs to display derived totals, compute them locally from the items rather than relying on the DB column.

4. **API contracts**
   - Document in `inventoryService` JSDoc that `amount` will not be auto-updated except for canonical IDs.
   - Ensure any future helper that mutates transactions first checks the canonical constraint.

5. **Tests**
   - Add targeted unit tests in `src/services/__tests__/inventoryService.test.ts`:
     - `addItemToTransaction` should preserve `amount` for non-canonical IDs.
     - Same helpers should still recalc for canonical IDs.
   - Add regression test for Transaction Audit flow (component or hook) asserting the stored `amount` remains stable after adding suggested items.

6. **Post-fix cleanup plan (follow-up)**
   - After locking behavior, run an audit script to compare `transactions.amount` vs. sum of linked items for non-canonical IDs to identify potential data corruption.
   - Coordinate with product/support on communication and remediation steps.

## Open Questions

- Are there any legacy canonical prefixes besides `INV_PURCHASE_` and `INV_SALE_`? Confirm all should remain dynamic.
- Should we add a secondary column (e.g., `derived_item_total`) for canonical tracking to avoid overloading `amount`?
- Do we need an admin tool to restore previous `amount` values from backups/logs?

## Next Steps

1. Implement the guarded helper logic and supporting tests.
2. Ship a hotfix release after QA validation.
3. Plan the remediation/audit workflow once behavior is stable.
