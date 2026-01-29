## Flow: Project → Business Inventory

This flow defines two distinct user intents that both result in “item ends up in Business Inventory,” but with different correctness requirements.

## A) Move to Business Inventory (correction path)

### Intent
The user is correcting scope: “This item should be in Business Inventory,” without creating canonical inventory transactions.

### Preconditions
- Item exists and is currently in the source project.
- Item is **not tied to any transaction**.

### Behavior contract
- If item has `transactionId != null`, block the action:
  - Copy: `This item is tied to a transaction. Move the transaction instead.`
- Apply item update:
  - `projectId = null`
  - `transactionId = null`
  - `inventoryStatus = available`
  - `disposition = inventory` (unless explicitly overridden)
- Append lineage edge (best-effort):
  - `fromTransactionId = item.latestTransactionId ?? null`
  - `toTransactionId = null`
  - Update pointers: `latestTransactionId = null`

Parity evidence:
- Guard + error: `src/pages/ItemDetail.tsx` (`handleMoveToBusinessInventory`)
- Core mutation: `src/services/inventoryService.ts` (`moveItemToBusinessInventory`)

## B) Deallocate/Sell to Business Inventory (canonical path)

### Intent
The user is designating the item as “inventory,” which must preserve canonical sale mechanics and lineage.

Primary entrypoints in web:
- “Sell to Design Business” action
- Setting disposition to `inventory` from the project items list or business inventory views

### Preconditions
- Item exists.
- For Firebase migration: Project → BI sell/deallocate may be blocked if `inheritedBudgetCategoryId` is missing (deterministic attribution). See `40_features/project-items/flows/inherited_budget_category_rules.md`.

### Behavior contract (canonical)

#### Step 1: Load item and resolve “previous project link”
Resolve these for later metadata preservation:
- `previousProjectTransactionId`
- `previousProjectId`

Parity evidence:
- `_resolvePreviousProjectLink` in `src/services/inventoryService.ts` (`deallocationService`).

#### Step 2: Purchase-reversion exception (required)
If `item.transactionId == INV_PURCHASE_<projectId>` (same project):
- Remove item from the purchase transaction (preserve empty canonical rows for lineage/history).
- Update item to Business Inventory:
  - `projectId = null`
  - `transactionId = null`
  - `inventoryStatus = available`
  - preserve `previousProjectTransactionId` / `previousProjectId`
- Append lineage edge:
  - `fromTransactionId = INV_PURCHASE_<projectId>`
  - `toTransactionId = null`

Parity evidence:
- Purchase-reversion: `deallocationService.handleInventoryDesignation` in `src/services/inventoryService.ts`.

#### Step 3: Canonical sale path (default)
Otherwise:
- Ensure canonical sale transaction exists/updates:
  - `saleTransactionId = INV_SALE_<projectId>`
  - Add this item to the sale transaction’s `item_ids` and recompute amount (sum of item prices in the bucket).
- Update item to Business Inventory and link it to the sale transaction:
  - `projectId = null`
  - `transactionId = INV_SALE_<projectId>`
  - `inventoryStatus = available`
  - Clear `space` (scope move)
  - preserve `previousProjectTransactionId` / `previousProjectId`
- Append lineage edge:
  - `fromTransactionId = item.transactionId || null` (pre-move)
  - `toTransactionId = INV_SALE_<projectId>`

Parity evidence:
- `deallocationService.ensureSaleTransaction` and subsequent item update in `src/services/inventoryService.ts`.

### Offline-first / outbox requirement (Firebase)
Represent the canonical deallocate operation as one outbox op with one idempotency key that the server uses to avoid duplication on retry.

Parity evidence (web outbox):
- `DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY` op: `src/types/operations.ts`
- Execution: `executeDeallocateItemToBusinessInventory` in `src/services/operationQueue.ts`
