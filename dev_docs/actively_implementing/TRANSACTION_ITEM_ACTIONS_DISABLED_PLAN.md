# Transaction Item Actions Disabled Plan

## Goal
Explain why delete/sell/move are disabled for items inside a regular (non-canonical) transaction, and lay out how to re-enable them safely and consistently.

## Problem Summary (Current Behavior)
When viewing items inside a transaction, the per-item actions menu shows delete/sell/move as disabled.

This happens for two independent reasons:

1) **Callbacks are not passed in the transaction context**, so the actions are treated as unavailable.
2) **Move actions are explicitly blocked** when an item is tied to any transaction (canonical or not).

## Root Causes (Where the Disablement Happens)

### A) `TransactionItemsList` omits action callbacks
`TransactionItemsList` renders `ItemPreviewCard` for transaction items but does not pass these callbacks:

- `onSellToBusiness`
- `onSellToProject`
- `onMoveToBusiness`
- `onMoveToProject`
- `onDelete`

Effect: the actions menu treats these as “not available in this context.”

### B) `ItemActionsMenu` blocks move when item is tied to a transaction
`ItemActionsMenu` disables move actions whenever `itemTransactionId` is set.

- Canonical transaction: “Move is not available.”
- Non-canonical transaction: “Move the transaction instead.”

Effect: even if we pass move callbacks, the move actions remain disabled until we relax this rule for regular transactions.

## Decision Points
We need to decide how these actions should behave for **regular (non-canonical) transactions**:

- **Delete item**: allow deleting the item record from the system (not just removing it from the transaction).
- **Sell item**: allow selling directly from the transaction view (define effect on transaction totals).
- **Move item**: allow moving to business or project inventory, even while tied to a transaction.

If these are allowed, we must also decide how the transaction should update (e.g., unlink item, update totals, maintain audit trail).

## Proposed Fix (High-Level)
Enable item-level delete/sell/move for regular transactions by:

1) **Wiring the action callbacks** through `TransactionItemsList` → `ItemPreviewCard`.
2) **Allowing move actions** when the item is tied to a **non-canonical** transaction.
3) **Defining business rules** for how each action changes the transaction and totals.

## Behavioral Rules (Recommended)

### Delete
- If user deletes an item that is part of a regular transaction:
  - The item is deleted from inventory.
  - The item is removed from the transaction.
  - Transaction totals are recomputed.
- Require confirmation dialog (“Delete item? This will remove it from the transaction.”).

### Sell
- If user sells an item from a transaction:
  - The item is updated to reflect a sold disposition.
  - Transaction totals are recomputed accordingly.
  - If the action implies removing the item from the transaction, document that explicitly.

### Move
- For non-canonical transactions, allow move actions:
  - Business inventory ↔ project inventory.
  - The item remains in the transaction unless we choose to unlink automatically.
  - Transaction totals update if move affects tax or price context.

### Canonical Transactions
- Keep current restrictions for canonical transactions (no move, no sell, and delete only via canonical flow).

## Implementation Steps
1) **Identify and expose callbacks**
   - Add optional callbacks to `TransactionItemsList` props:
     - `onDeleteItem`
     - `onSellToBusiness`
     - `onSellToProject`
     - `onMoveToBusiness`
     - `onMoveToProject`
   - Pass them into `ItemPreviewCard` in `renderTransactionItem`.

2) **Hook up handlers in `TransactionDetail`**
   - Use existing item handlers or create new ones for:
     - delete
     - sell
     - move
   - Ensure these handlers update the transaction items array and totals.

3) **Relax move restriction for regular transactions**
   - In `ItemActionsMenu`, only block move actions when:
     - `isCanonicalTransaction === true`, or
     - We decide a non-canonical move should still be blocked (if so, explain why).

4) **Define confirmations and feedback**
   - Add confirmation dialog for delete (and possibly sell/move if destructive).
   - Success/error toast messages consistent with other inventory actions.

5) **Update totals and derived fields**
   - Ensure any action that changes item status or location recomputes transaction totals.
   - Confirm item remains linked/unlinked per the chosen rules.

## Testing Plan
### Manual
- Regular transaction: delete item → item gone; transaction totals updated.
- Regular transaction: sell item → status updated; totals updated.
- Regular transaction: move item → location updated; totals updated if needed.
- Canonical transaction: move/sell remain disabled.

### Automated (follow-up)
- Unit test `ItemActionsMenu` move availability for canonical vs regular transaction.
- Transaction detail test: actions update items + totals properly.

## Notes
This plan focuses only on **regular (non-canonical) transactions**. Canonical transactions should remain locked down unless explicitly expanded by product decision.
