## Flow: Business Inventory → Project allocation

## Intent
Move one or more Business Inventory items into a target project, updating canonical purchase mechanics and lineage deterministically.

## Preconditions
- Item exists.
- Target project exists and user has permission.
- Firebase migration requirement: user must choose a destination budget category (batch choice), persisted to `item.inheritedBudgetCategoryId`.  
  Source of truth: `40_features/project-items/flows/inherited_budget_category_rules.md`.

## Behavior contract (single item)

### Step 1: Determine expected canonical purchase bucket
- `purchaseTransactionId = INV_PURCHASE_<projectId>`

Parity evidence:
- `allocateItemToProject` in `src/services/inventoryService.ts` (returns this id in offline path and uses it as canonical target online).

### Step 2: Deterministic state machine for current canonical linkage
Allocation must handle items currently in:
- `INV_SALE_<someProjectId>`
- `INV_PURCHASE_<someProjectId>`
- no `transactionId` (inventory)

Parity evidence:
- Deterministic branching in `allocateItemToProject` in `src/services/inventoryService.ts` (“Scenario A/B/C”).

### Step 3: Apply updates atomically (Firebase requirement)
Allocation is a multi-entity update (item + canonical transaction + lineage + change-signal). In Firebase it must be server-owned and transactional.

Minimum resulting item state:
- `projectId = <projectId>`
- `transactionId = INV_PURCHASE_<projectId>`
- `inventoryStatus = allocated`
- `disposition = purchased` (or equivalent)
- optional: set/clear `space` as selected

Parity evidence (web):
- Item updates in `src/services/inventoryService.ts` (`handleInventoryToPurchaseMove` and related helpers).

### Step 4: Lineage
Append lineage edge representing the move:
- inventory (null) → `INV_PURCHASE_<projectId>` when allocating from inventory
- or `INV_SALE_*` / `INV_PURCHASE_*` → `INV_PURCHASE_<projectId>` when moving between canonical buckets

Parity evidence:
- `lineageService.appendItemLineageEdge` calls inside allocation helpers in `src/services/inventoryService.ts`.

## Offline-first / outbox requirement (Firebase)
Represent allocation as one outbox op with one idempotency key.

Parity evidence (web outbox):
- `ALLOCATE_ITEM_TO_PROJECT` op: `src/types/operations.ts`
- Execution: `executeAllocateItemToProject` in `src/services/operationQueue.ts`

## Batch allocation (optional parity detail)
The current web service also supports batch allocation, updating the same canonical purchase bucket.

Parity evidence:
- Batch allocate comment and implementation near `Batch allocate multiple items...` in `src/services/inventoryService.ts`.
