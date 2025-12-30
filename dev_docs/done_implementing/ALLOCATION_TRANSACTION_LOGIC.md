# Allocation Transaction Logic (Authoritative)

## Scope
Rules for how items move between inventory and project transactions, and how transactions are created, updated, or removed as a result.  Do not change transaction type to 'Sale'.  Do ensure functions are named appropriately.

## Definitions
- **Sale Transaction**: The project is selling the item TO us.
- **Purchase Transaction**: The project is buying the item FROM us.
- **Transaction Amount**: Sum of included item values. Must match the items in the transaction.

## Invariants
- An item is in exactly one transaction or in regular inventory (never multiple).

## Cancellation Rule (only when appropriate)
- When removing an item from a transaction:
  - If other items remain → keep the transaction and update the amount.
  - If no items remain → delete the transaction.

## Deterministic Flows

### A. Item currently in a Sale (Project X)

1) Allocate to same project (Project X)
```
Sale(Project X) --remove item--> Inventory
Sale(Project X).amount -= itemValue
If Sale(Project X).items == ∅ → delete Sale(Project X)
```

2) Allocate to different project (Project Y)
```
Sale(Project X) --remove item--> (amount -= itemValue; delete if empty)
→ Add item to Purchase(Project Y) (create if none)
Purchase(Project Y).amount += itemValue
```

### B. Item currently in a Purchase (Project X)

1) Allocate to same project (Project X)
```
Purchase(Project X) --remove item--> Inventory
Purchase(Project X).amount -= itemValue
If Purchase(Project X).items == ∅ → delete Purchase(Project X)
```

2) Allocate to different project (Project Y)
```
Purchase(Project X) --remove item--> (amount -= itemValue; delete if empty)
→ Add item to Sale(Project Y) (create if none)
Sale(Project Y).amount += itemValue
```

### C. Item in Inventory (no transaction)

1) Project X buys from us
```
Inventory --add item--> Purchase(Project X) (create if none)
Purchase(Project X).amount += itemValue
```

2) Project X sells to us
```
Inventory --add item--> Sale(Project X) (create if none)
Sale(Project X).amount += itemValue
```

## Validation and Accounting
- Transaction amounts must equal the sum of current items.
- Prevent negative totals; refuse operations that would desync totals.
- Enforce single-transaction invariant before performing a move.

## Side Effects (non-functional requirements)
- Update item’s status/location after each move.
- Recompute any project budgets/rollups affected by the change.
- Log allocation/de-allocation events for auditability.


