# Allocation Transaction Logic (Authoritative)

## Scope
Rules for how items move between business inventory and projects, and how canonical transactions are created, updated, or removed as a result.

## Business Context
We are an interior design business. We maintain our own **business inventory** (items the business owns). We work on **projects** for clients. Items move between inventory and projects:
- Sometimes we purchase items for inventory and later sell them to a project.
- Sometimes we purchase items directly on behalf of a client/project, and those items start in the project (never in inventory).
- A project/client can sell items back to the business at any time.
- Items can transfer between projects by going through inventory (two hops).

## Definitions
- **Business Inventory**: Items the business currently holds, not assigned to any project. `projectId = null`.
- **Project**: A client engagement. Items in a project have `projectId = <projectId>`.
- **Purchase Transaction (`INV_PURCHASE_<projectId>`)**: Records items a project has acquired from business inventory. The project purchased these items from the business.
- **Sale Transaction (`INV_SALE_<projectId>`)**: Records items a project has returned to business inventory. The project sold these items back to the business.
- **Transaction Amount**: Sum of included item values. Must match the items in the transaction.

## Invariants
- An item lives in exactly one place: either in inventory or in a project.
- An item is in at most one canonical transaction (never multiple).
- Not all items in a project have a canonical transaction — items purchased directly for a client may have no canonical transaction.

## Reversion Rule
Before creating a new canonical transaction for a movement, check whether the item is already in a canonical transaction that this movement would **undo**:
- Moving an item from project → inventory when it is in `INV_PURCHASE_<sameProject>`: **revert the purchase** (remove item from the purchase transaction) instead of creating a new sale transaction. This undoes the original sale-to-project.
- Moving an item from inventory → project when it is in `INV_SALE_<sameProject>`: **revert the sale** (remove item from the sale transaction) instead of creating a new purchase transaction. This undoes the original return-to-inventory.

## Cancellation Rule
When removing an item from a transaction:
- If other items remain → keep the transaction, update the amount.
- If no items remain → delete the transaction.

## Deterministic Flows

All scenarios answer: **"An item needs to be allocated to Project Y. What is its current state?"**

### A. Item is in `INV_SALE_<X>` (Project X previously sold it to inventory)

**A.1 — Allocate to same Project X (revert the sale)**
```
Remove item from Sale(X). Update amount. Delete Sale(X) if empty.
Item returns to Project X (with its previous transaction link if available).
```
This undoes the sale — the project is taking the item back.

**A.2 — Allocate to different Project Y**
```
Remove item from Sale(X). Update amount. Delete Sale(X) if empty.
Add item to Purchase(Y). Create Purchase(Y) if needed. Update amount.
Item moves to Project Y.
```
The item was returned from Project X; now a different project is acquiring it.

### B. Item is in `INV_PURCHASE_<X>` (Project X previously purchased it from inventory)

**B.1 — Allocate to same Project X (revert the purchase)**
```
Remove item from Purchase(X). Update amount. Delete Purchase(X) if empty.
Item returns to inventory.
```
This undoes the purchase — the item goes back to business inventory.

**B.2 — Allocate to different Project Y (redirect)**
```
Remove item from Purchase(X). Update amount. Delete Purchase(X) if empty.
Item returns to inventory (revert the purchase from X).
Add item to Purchase(Y). Create Purchase(Y) if needed. Update amount.
Item moves to Project Y.
```
The item was headed to Project X, but should go to Project Y instead. This reverts the purchase from X (item back to inventory), then creates a new purchase for Y.

### C. Item is in inventory (no canonical transaction)

**Allocate to Project Y**
```
Add item to Purchase(Y). Create Purchase(Y) if needed. Update amount.
Item moves to Project Y.
```

### D. Item is in a project with no canonical transaction

This covers items that were purchased directly for a client and never came from business inventory.

**Deallocate to inventory (Sell to Business)**
```
Add item to Sale(X). Create Sale(X) if needed. Update amount.
Item moves to inventory.
```
The project is selling the item to the business for the first time.

## Cross-Project Transfers
Moving an item from Project A to Project B is always two sequential operations:
1. **Project A → Inventory**: Either revert `Purchase(A)` (if item was originally from inventory) or create `Sale(A)` (if item originated in the project).
2. **Inventory → Project B**: Create `Purchase(B)`.

There is no direct project-to-project movement. All transfers flow through inventory.

## Validation and Accounting
- Transaction amounts must equal the sum of current item values.
- Prevent negative totals; refuse operations that would desync totals.
- Enforce single-transaction invariant before performing a move.

## Side Effects
- Update item's `projectId`, `transactionId`, and `inventoryStatus` after each move.
- Recompute any project budgets/rollups affected by the change.
- Log allocation/deallocation events for auditability.
- Append lineage edges tracking the movement for audit trail.
