# Inventory operations + lineage — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Canonical transaction ids (system-owned)
- [ ] **Canonical detection**: Canonical inventory transactions are detected by id prefix `INV_PURCHASE_`, `INV_SALE_`, `INV_TRANSFER_`.  
  Observed in `src/services/inventoryService.ts` (`CANONICAL_TRANSACTION_PREFIXES`, `isCanonicalTransactionId`).
- [ ] **Canonical invariants are checkable** after outbox flush for multi-entity ops (projectId/transactionId expectations).  
  Observed in `src/services/operationQueue.ts` (`verifyCanonicalInvariants`).

## Project → Business Inventory (Move: correction path)
- [ ] **Blocked when transaction-attached**: “Move to business inventory” is blocked when the item is tied to any transaction (canonical or non-canonical) with copy that instructs the user to move the transaction instead.  
  Observed in `src/services/inventoryService.ts` (`moveItemToBusinessInventory` throws `TRANSACTION_ATTACHED`) and `src/pages/ItemDetail.tsx` (shows error).
- [ ] **Move updates scope without canonical sale**: Move correction sets `projectId = null`, `transactionId = null`, `inventoryStatus = available`, and updates disposition to `inventory` (or provided override).  
  Observed in `src/services/inventoryService.ts` (`moveItemToBusinessInventory`).
- [ ] **Move appends lineage edge** from previous transaction (or null) to null and updates pointers (best-effort).  
  Observed in `src/services/inventoryService.ts` (`moveItemToBusinessInventory` uses `lineageService.*`).

## Project → Business Inventory (Deallocate/Sell: canonical path)
- [ ] **Disposition → inventory triggers deallocation**: setting item disposition to `inventory` triggers the deallocation flow.  
  Observed in `src/pages/InventoryList.tsx` and `src/pages/BusinessInventory.tsx` (`updateDisposition`).
- [ ] **Deallocation is outbox-able** when offline (queues one op) and surfaces offline “saved” messaging.  
  Observed in `src/services/inventoryService.ts` (`integrationService.handleItemDeallocation` enqueues `enqueueDeallocateItemToBusinessInventory`) and UI offline messaging in `src/pages/ItemDetail.tsx`.
- [ ] **Purchase-reversion exception**: if the item is linked to `INV_PURCHASE_<sameProjectId>`, deallocation removes it from the purchase and returns to inventory without creating `INV_SALE_<projectId>`.  
  Observed in `src/services/inventoryService.ts` (`deallocationService.handleInventoryDesignation` purchase-reversion branch).
- [ ] **Otherwise canonical sale**: deallocation ensures `INV_SALE_<projectId>` exists/updates, moves the item to business inventory, and links the item to `INV_SALE_<projectId>`.  
  Observed in `src/services/inventoryService.ts` (`deallocationService.ensureSaleTransaction` + item update).
- [ ] **Lineage edge appended** for deallocation moves (best-effort) and pointers updated.  
  Observed in `src/services/inventoryService.ts` (`deallocationService.handleInventoryDesignation`) and `src/services/lineageService.ts`.

## Business Inventory → Project (Allocate: canonical purchase)
- [ ] **Allocate creates/updates canonical purchase**: allocating to project links the item to `INV_PURCHASE_<projectId>` and sets `inventoryStatus = allocated`.  
  Observed in `src/services/inventoryService.ts` (`allocateItemToProject`, `handleInventoryToPurchaseMove`, and helpers).
- [ ] **Allocate is outbox-able** when offline (queues one op) and returns the expected canonical id.  
  Observed in `src/services/inventoryService.ts` (`allocateItemToProject` offline path) and `src/services/operationQueue.ts` (`executeAllocateItemToProject`).

## Project → Project (Sell item to another project)
- [ ] **Two-phase canonical behavior**: sell-to-project performs a deallocation step then an allocation step.  
  Observed in `src/services/inventoryService.ts` (`sellItemToProject`).
- [ ] **Offline behavior**: selling to project is queueable offline, returning `INV_SALE_<sourceProjectId>` and `INV_PURCHASE_<targetProjectId>` as expected ids.  
  Observed in `src/services/inventoryService.ts` (`sellItemToProject` offline branch) and `src/types/operations.ts` (`SELL_ITEM_TO_PROJECT`).
- [ ] **Partial completion handling**: if the sale completes but allocation fails, user sees a message that the item is now in business inventory and must be allocated from there.  
  Observed in `src/services/inventoryService.ts` (`SellItemToProjectError` code `PARTIAL_COMPLETION`) and handling in `src/pages/ItemDetail.tsx` / `src/pages/TransactionDetail.tsx`.

## Lineage requirements
- [ ] **Append-only lineage edges** are recorded for cross-scope moves and can be fetched for an item history view.  
  Observed in `src/services/lineageService.ts` (`appendItemLineageEdge`, `getItemLineageHistory`).
- [ ] **Idempotency / duplicate suppression** exists for rapid repeated edge writes.  
  Observed in `src/services/lineageService.ts` (5-second duplicate window).
- [ ] **Pointers updated** so UI can show “latest transaction” without recomputing history.  
  Observed in `src/services/lineageService.ts` (`updateItemLineagePointers`).

## Budget-category determinism (Firebase)
- [ ] **BI → Project category prompt is required** and the selected destination category is persisted on the item as `inheritedBudgetCategoryId`.  
  **Intentional delta / required** by `40_features/project-items/flows/inherited_budget_category_rules.md`.
- [ ] **Project → BI sell/deallocate is blocked if `inheritedBudgetCategoryId` is missing** (deterministic attribution requirement).  
  **Intentional delta / required** by `40_features/project-items/flows/inherited_budget_category_rules.md`.

## Firebase-specific invariant enforcement (server-owned)
- [ ] **Multi-entity inventory ops are server-owned** (Callable Function / Firestore transaction), not “best effort” client multi-write.  
  **Intentional delta / required** by `40_features/sync_engine_spec.plan.md` (server-owned invariants).
- [ ] **Idempotency key**: Each operation is safe under retry via `lastMutationId`/`opId` and does not double-apply on reconnect or after app restart.  
  **Intentional delta / required** by `40_features/sync_engine_spec.plan.md` (outbox idempotency).

## Collaboration / propagation (Firebase)
- [ ] **No large listeners**: inventory ops do not require listeners on items/transactions collections.  
  **Intentional delta / required** by `40_features/sync_engine_spec.plan.md`.
- [ ] **Change-signal bump**: successful server mutation bumps `accounts/{accountId}/projects/{projectId}/meta/sync` so other foregrounded clients delta-sync quickly.  
  **Intentional delta / required** by `40_features/sync_engine_spec.plan.md` (§4).
