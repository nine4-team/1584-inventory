#+#+#+#+-----------
Title: Lineage-Edge Validation Plan (Project Sale + Return)
Owner: AI model (implementation agent)
Status: Draft
Last updated: 2026-01-22
Audience: Engineering
Purpose: Ensure lineage edges preserve history while maintaining single current transaction.
---------------------------------------------------------------------------#

## Goals
- Use lineage edges to preserve historical membership in prior transactions.
- Keep the "single current transaction" invariant for items.
- Allow transaction cleanup only for true reversions (buy/sell back same project).
- Preserve canonical sale/purchase rows when history must be visible via lineage.

## Definitions
- **Current transaction**: The transaction ID stored on the item (`items.transaction_id`).
- **Historical membership**: Prior transactions represented by lineage edges.
- **Moved out**: Item no longer in a transaction's `item_ids`, but shown via lineage edge.
- **Canonical transactions**: `INV_SALE_*` and `INV_PURCHASE_*`.

## Preservation Rule (explicit)
- When a canonical transaction is only represented through lineage edges (no active items),
  the transaction row must still remain **if it is needed for history**.
- Deletion is allowed **only** for true reversions where the transaction is
  semantically canceled (not just moved out).

## True Reversion (clarified)
Treat these as reversions that may delete the now-empty canonical transaction:
- **Project → Inventory → Same Project** (sell to inventory, then buy back).
- **Inventory → Project → Inventory** (purchase into a project, then return back).

## Scope
Two scenarios must work correctly:
1) Project → Project sale (via business inventory).
2) Purchase → Return (within the same project).

## Preconditions
- Lineage edges are already used in `TransactionDetail` to show moved items.
- Allocation flows follow `ALLOCATION_TRANSACTION_LOGIC.md`.

## Scenario 1: Project → Project sale (via business inventory)
### Intent
When a project sells an item to another project, the item should end up in the destination purchase transaction, while the source sale should still show the item via lineage edges (as moved out).

### Expected Behavior
- Source sale `INV_SALE_<sourceProjectId>` exists.
- Item is **not** in `item_ids` of the sale after allocation completes.
- Item **is** in `item_ids` of `INV_PURCHASE_<targetProjectId>`.
- A lineage edge exists from `INV_SALE_<sourceProjectId>` → `INV_PURCHASE_<targetProjectId>`.
- UI displays the item in the sale transaction as "moved out" (gray).

### Verification Steps
1. Trigger sell-to-project flow in UI for an item in Project A → Project B.
2. Check `items.transaction_id` is `INV_PURCHASE_<projectB>`.
3. Verify sale transaction row exists.
4. Verify sale transaction `item_ids` does **not** include the item.
5. Verify purchase transaction `item_ids` **does** include the item.
6. Verify lineage edge from sale → purchase for this item.
7. Confirm Transaction Detail for sale shows item under "Moved out."

### Failure Modes to Watch
- Sale transaction deleted after allocation (should not happen).
- Missing lineage edge (item disappears from sale history).
- Item still in sale `item_ids` (violates single-transaction invariant).

## Scenario 2: Purchase → Return (same project)
### Intent
When a project buys an item and later returns it, the return should be the current transaction while the original purchase still shows the item via lineage edges (as moved out).

### Expected Behavior
- Item ends up in a **return** transaction (or inventory) as the current state.
- Original purchase transaction remains in history via lineage edge.
- If return undoes the purchase entirely (true reversion), the purchase transaction can be deleted **only** if its `item_ids` becomes empty.

### Verification Steps
1. Allocate an inventory item to Project A (creates `INV_PURCHASE_<A>`).
2. Trigger a return flow for the same item.
3. Check `items.transaction_id` reflects the return (or null if returned to inventory).
4. Verify purchase transaction exists or is deleted only if empty and reversion is intended.
5. Verify lineage edge from purchase → return (or purchase → null if returned to inventory).
6. Confirm Transaction Detail for purchase shows item under "Moved out."

### Failure Modes to Watch
- Purchase transaction removed without lineage edge (history lost).
- Item remains current in purchase after return (state incorrect).

## Code Areas to Review (non-exhaustive)
- `src/services/inventoryService.ts`
  - `sellItemToProject(...)`
  - `allocateItemToProject(...)` (Scenario A.2)
  - `handleSaleToDifferentProjectMove(...)`
  - `handlePurchaseToInventoryMove(...)` (return case)
  - `removeItemFromTransaction(...)` (deletion rules)
- `src/pages/TransactionDetail.tsx` (moved-out display logic)

## Acceptance Criteria
- Both scenarios preserve history through lineage edges.
- Items remain in exactly one **current** transaction.
- Transactions are deleted only when truly empty and reverting is intended.
---------------------------------------------------------------------------#
