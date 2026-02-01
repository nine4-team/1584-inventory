# Feature spec: Inventory operations + lineage (Firebase mobile migration)

## Intent
Provide a deterministic, offline-first way to perform **cross-entity inventory operations** (allocate/move/sell/deallocate) while preserving:

- **Correctness** across items ↔ transactions ↔ projects
- **Idempotency** under retries (no double-sell / double-allocate)
- **Lineage visibility** (audit path and “where did this go?” cues)
- **Cost control** (no large collection listeners; change-signal + delta sync only)

This spec is written for the React Native + Firebase target architecture described in `40_features/sync_engine_spec.plan.md`.

## Key definitions

### Scopes
- **Project scope**: item has `projectId = <projectId>`.
- **Business Inventory scope**: item has `projectId = null`.

### Canonical inventory transactions
Canonical inventory transactions are system-owned mechanics. Their ids use these prefixes:

- `INV_PURCHASE_<projectId>` — canonical purchase bucket used when allocating items into a project
- `INV_SALE_<projectId>` — canonical sale bucket used when moving items from a project into business inventory (except purchase-reversion)

Parity evidence:
- Canonical id detection: `isCanonicalTransactionId` in `src/services/inventoryService.ts`
- Canonical invariants verification for queued ops: `verifyCanonicalInvariants` in `src/services/operationQueue.ts`

### “Move” vs “Sell/Deallocate”
This migration must preserve the web distinction:

- **Move to business inventory (correction)**: scope correction for an item that is **not tied to a transaction**. Does **not** create/require a canonical sale.
- **Sell/Deallocate to business inventory (canonical)**: an inventory designation operation that **creates/updates `INV_SALE_<projectId>`**, unless it is a purchase-reversion case.

Parity evidence:
- Move correction blocks transaction-attached items: `moveItemToBusinessInventory` in `src/services/inventoryService.ts` and UI enforcement in `src/pages/ItemDetail.tsx`
- Canonical deallocation entrypoint: `integrationService.handleItemDeallocation` → `deallocationService.handleInventoryDesignation` in `src/services/inventoryService.ts`
- Disposition → inventory triggers canonical deallocation: `updateDisposition` in `src/pages/InventoryList.tsx` and `src/pages/BusinessInventory.tsx`

## Architecture constraints (must hold)

### Local-first + outbox
All user actions apply to the local DB first, enqueueing **one** outbox op that represents the user intent. The outbox flush applies the server mutation with `lastMutationId` idempotency.

Reference: `40_features/sync_engine_spec.plan.md` (§5 write path / outbox).

### Server-owned invariants for multi-entity correctness (Firebase)
Multi-entity operations in this feature MUST be implemented as server-owned invariants, because they update multiple documents and must be idempotent under retries.

Required Firebase shape (conceptual):
- Callable Function per operation (or one function with a discriminated union op payload), executed as a Firestore transaction:
  - `inventory_deallocate_to_business(...)`
  - `inventory_allocate_to_project(...)`
  - `inventory_sell_item_to_project(...)`

Each function must:
- Validate permissions (membership + role).
- Validate preconditions (expected current state; detect conflicts).
- Apply all document writes atomically (items + canonical transaction docs + lineage docs + change-signal).
- Use an idempotency key (`opId` / `lastMutationId`) to make retries safe.

## Core flows (spec-level summary)

Detailed flow specs live under `flows/`.

### 1) Project → Business Inventory (Move: correction path)
User intent: “This item should be in Business Inventory.”

Required behavior:
- Block if item is tied to a transaction (canonical or non-canonical): user must move the transaction instead.
- Update item to business inventory scope without creating a canonical sale transaction.
- Append a lineage edge representing the move.

Parity evidence:
- Guard + error copy: `src/pages/ItemDetail.tsx` (`handleMoveToBusinessInventory`) and `src/components/items/ItemActionsMenu.tsx`
- Core mutation + lineage update: `moveItemToBusinessInventory` in `src/services/inventoryService.ts`

### 2) Project → Business Inventory (Deallocate/Sell: canonical path)
User intent: “Move this item to Business Inventory (inventory designation), preserving canonical mechanics.”

Required behavior:
- If the item is currently linked to `INV_PURCHASE_<sameProjectId>`, treat as **purchase-reversion**:
  - remove from that purchase and return to inventory (do **not** create `INV_SALE_<projectId>`)
- Otherwise:
  - ensure/update `INV_SALE_<projectId>`
  - move the item to business inventory and link it to `INV_SALE_<projectId>`
  - append lineage edge (from prior transaction → sale transaction)

Parity evidence:
- Purchase-reversion path: `deallocationService.handleInventoryDesignation` in `src/services/inventoryService.ts`

### 3) Business Inventory → Project (Allocate: canonical purchase)
User intent: “Move this item into Project X.”

Required behavior:
- Ensure/update `INV_PURCHASE_<projectId>` and link the item to it.
- Set item `projectId = <projectId>` and `inventoryStatus = allocated` (or equivalent).
- Append lineage edge (from prior transaction or inventory → purchase transaction).

Parity evidence:
- Allocation deterministic branching: `allocateItemToProject` in `src/services/inventoryService.ts`
- Offline queue operation types: `ALLOCATE_ITEM_TO_PROJECT` in `src/types/operations.ts` and `executeAllocateItemToProject` in `src/services/operationQueue.ts`

### 4) Project → Project (Sell item to another project)
User intent: “Sell this project item to Project Y.”

Required behavior:
- Two-phase canonical flow:
  - Deallocate from source project into business inventory (canonical sale or purchase-reversion if applicable)
  - Allocate into target project (canonical purchase)
- Partial completion handling must be explicit:
  - If sale completes but purchase fails, surface an error that tells the user the item is now in Business Inventory and must be allocated from there.

Parity evidence:
- `sellItemToProject` in `src/services/inventoryService.ts` (two-step, includes PARTIAL_COMPLETION error)
- UI surfaces this error: `src/pages/ItemDetail.tsx` and `src/pages/TransactionDetail.tsx`

## Budget-category determinism (required)
Business Inventory → Project operations must integrate with the destination budget category selection rule and persist it on the item as `inheritedBudgetCategoryId`.

Source of truth:
- `40_features/project-items/flows/inherited_budget_category_rules.md`

Implementation note (Firebase):
- Category choice must be part of the server-owned invariant for BI → Project operations so retries remain deterministic.

## Lineage (required)
Lineage is required to support:
- “Where did this item go?” cues in Transaction Detail / Item Detail
- Auditability across cross-scope moves

Required model (conceptual):
- Append-only edges: `(fromTransactionId, toTransactionId, createdAt, createdBy, note?)`
- Maintain pointers on the item record for quick UI access (e.g. `latestTransactionId`, optionally `originTransactionId`)

Parity evidence:
- `src/services/lineageService.ts` (`appendItemLineageEdge`, `updateItemLineagePointers`)

## Collaboration / realtime expectations (Firebase target)
- Do not attach listeners to large collections for “freshness.”
- For project-scoped operations, the server writes must bump the project `meta/sync` change-signal so other foregrounded clients run delta sync within ~1–3 seconds typical.

Reference: `40_features/sync_engine_spec.plan.md` (§4 change signal doc).
