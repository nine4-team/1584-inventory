---
name: Sell to project backend plan
overview: Concrete backend/service plan for item-actions menu flows, centered on implementing Sell → Project orchestration and verifying other menu actions against existing inventory/transaction/lineage/offline infrastructure.
todos:
  - id: extract-actions
    content: List all backend-relevant menu actions and their required semantics from the three-dot menu plan doc, then map each to existing services or gaps.
    status: completed
  - id: verify-existing-services
    content: Verify existing inventory/transaction/lineage/offline capabilities in codebase (inventoryService, lineageService, offlineTransactionService, migrations) to avoid assumptions.
    status: completed
  - id: sell-to-project-orchestration
    content: Design concrete Sell → Project orchestration plan (records touched, canonical transaction naming/linking, failure handling, concurrency/idempotency, offline stance).
    status: completed
  - id: gap-list-and-steps
    content: Produce a gap list with current state/missing pieces and propose service-layer APIs, data model impacts, and an incremental implementation + test plan.
    status: completed
---

## Summary

- Implement **Sell → Project** by extending the existing **allocation engine** (`unifiedItemsService`) to support an explicit “sell across projects” orchestration: (a) inventory designation (canonical sale) to business inventory, then (b) allocation (canonical purchase) into the target project, with lineage/audit updates.
- Confirmed that most other item-actions menu operations already exist in the repo (sell-to-business-inventory via inventory designation, allocate/return via allocation logic, change status via `disposition`, add/change/unlink transaction, delete, canonical-transaction guardrails, lineage edges, and offline queue primitives). The main gap is **a single authoritative Sell → Project entry point on the allocation service**, plus a few correctness/consistency decisions (canonical history + partial-failure behavior).

## Verified existing backend capabilities

- Canonical inventory transaction conventions
- Implemented canonical IDs using prefixes (notably `INV_PURCHASE_<projectId>` and `INV_SALE_<projectId>`), with helper `isCanonicalTransactionId` in [`src/services/inventoryService.ts`](src/services/inventoryService.ts).
- Canonical transactions store `item_ids` arrays and are used throughout UI and services.
- Allocation / deallocation primitives already exist (the building blocks for Sell → Project)
- `unifiedItemsService.allocateItemToProject(accountId, itemId, projectId, amount?, notes?, space?)` in [`src/services/inventoryService.ts`](src/services/inventoryService.ts).
- Handles deterministic state transitions when the item is currently in `INV_SALE_*`, `INV_PURCHASE_*`, or “inventory/no transaction”.
- `deallocationService.handleInventoryDesignation(accountId, itemId, projectId, disposition)` in [`src/services/inventoryService.ts`](src/services/inventoryService.ts).
- This is the existing “Sell To Design Business” path (inventory designation), creating/updating `INV_SALE_<projectId>` and moving the item to business inventory.
- `integrationService.allocateBusinessInventoryToProject(...)` and `integrationService.handleItemDeallocation(...)` in [`src/services/inventoryService.ts`](src/services/inventoryService.ts) expose the above to callers.
- Transaction linking/unlinking and transaction `item_ids` management
- `unifiedItemsService.addItemToTransaction(...)`, `unifiedItemsService.removeItemFromTransaction(...)`, and `unifiedItemsService.unlinkItemFromTransaction(...)` exist in [`src/services/inventoryService.ts`](src/services/inventoryService.ts).
- There is explicit logic to keep transaction `item_ids` synced and to retry sync via the operation queue when needed.
- Lineage/audit infrastructure exists
- Append-only lineage edges in [`src/services/lineageService.ts`](src/services/lineageService.ts) with a basic idempotency guard.
- DB support for lineage edges exists via migrations [`supabase/migrations/012_add_item_lineage.sql`](supabase/migrations/012_add_item_lineage.sql) plus backfill/RLS migrations.
- Allocation/deallocation flows already append lineage edges and update item lineage pointers (`origin_transaction_id`, `latest_transaction_id`).
- Delete safety for transaction `item_ids`
- A DB trigger keeps `transactions.item_ids` from retaining references to deleted items via [`supabase/migrations/20251231_sync_transaction_item_ids_on_delete.sql`](supabase/migrations/20251231_sync_transaction_item_ids_on_delete.sql).
- Offline architecture exists (but inventory allocation/deallocation is currently online-first)
- `operationQueue` and `offlineTransactionService` exist in [`src/services/offlineTransactionService.ts`](src/services/offlineTransactionService.ts) and related services.
- Inventory canonical workflows (`allocateItemToProject`, deallocation) are implemented as live Supabase mutations (no explicit offline equivalents today), so Sell → Project should be treated as online-only unless extended.

## Missing backend capabilities (gap list)

### Gap 1: Sell → Project orchestration API (primary)

- Current state
- The doc explicitly calls this out as missing.
- The primitives to perform “sale → purchase” transitions exist (`deallocationService.handleInventoryDesignation`, `unifiedItemsService.allocateItemToProject`), but there is **no single, authoritative entry point on the allocation engine** that:
- Validates preconditions consistently across contexts (item persisted, not tied to non-canonical tx, source project correctness)
- Executes both steps as one operation
- Provides idempotency/concurrency protections
- Surfaces typed errors to the UI
- Missing pieces
- A dedicated backend-facing entry point, with robust partial-failure handling and clear user-visible failure semantics.
- A decision on canonical transaction retention semantics for intermediate steps (see Gap 2).
- Proposed service-layer API
- Add to `unifiedItemsService` (authoritative API surface):
- `sellItemToProject(accountId: string, itemId: string, sourceProjectId: string, targetProjectId: string, options?: { amount?: string; notes?: string; space?: string; idempotencyKey?: string }): Promise<{ saleTransactionId: string | null; purchaseTransactionId: string }>`
- Keep `integrationService.sellItemToProject(...)` optional as a thin UI convenience wrapper only; it must delegate to `unifiedItemsService`.
- Data model impacts
- No schema changes required for the initial implementation (compose existing deallocation + allocation).
- Optional later: add a DB RPC + idempotency log table if we need atomicity/stronger idempotency (see “Data model / migrations”).
- Error handling and user-visible failure states
- Return typed, user-safe errors for:
- Item not found / not persisted
- Item not in `sourceProjectId` (stale UI)
- Item tied to a non-canonical transaction (in menu plan this is generally disallowed)
- Item already moved/sold by another user (conflict)
- Target project equals source project (no-op)
- UI should be able to map these to:
- “This item has changed since you opened it; refresh and try again.”
- “This item is tied to a transaction; move the transaction instead.”
- “Not available offline.”
- Offline implications
- Initial implementation should be **online-only** (disable in UI when offline) unless you introduce a new queued operation type.

### Gap 2: Canonical transaction history expectations for Sell → Project

- Current state
- Canonical flows sometimes remove an item from a canonical transaction’s `item_ids` and may delete the transaction if it becomes empty.
- Transaction detail completeness logic already consults lineage edges for “moved out” items, and the DB delete-trigger only handles deletes (not moves).
- Missing pieces
- A clear policy for **whether canonical `INV_SALE_*` should retain the sold item in `item_ids` for history** when Sell → Project immediately proceeds to a purchase into another project.
- Proposed approach (recommended for correctness)
- For Sell → Project, ensure the **source project’s `INV_SALE_<sourceProjectId>` transaction remains a durable record** of the sale.
- Implement this either by (a) treating canonical sale `item_ids` membership as append-only for that item in the Sell → Project flow, or (b) accepting that canonical sale transactions may be deleted when empty and relying on audit + lineage as the durable history record.
- Data model impacts
- Potentially none if you accept “history is audit+lineage”; otherwise you may need to adjust service logic and/or add an explicit “inventory transfer” record.

### Gap 3: “Move → Move To Design Business” as a distinct non-sale operation (only if product requires it)

- Current state
- The repo supports a robust “inventory designation” path that creates/updates canonical `INV_SALE_<projectId>`.
- The menu plan distinguishes “Sell to Design Business” (sale) from “Move to Design Business” (non-sale).
- Missing pieces
- If “Move” must not create/update a canonical sale transaction, you likely need a new service method that:
- Moves `projectId → null`
- Clears or preserves transaction links according to invariants
- Appends lineage edges
- Does not affect canonical sale/purchase accounting
- Proposed service-layer API (if required)
- `moveItemToBusinessInventory(accountId: string, itemId: string, sourceProjectId: string, options?: { note?: string }): Promise<void>`
- Data model impacts
- Likely no schema change; relies on existing item fields + lineage edges.
- Error handling / UI states
- Should hard-fail (and UI should disable) when the item is tied to any transaction (canonical or not) unless a safe semantics is explicitly chosen.
- Offline implications
- Online-only unless queued.

## Sell → Project backend orchestration plan (detailed)

### Desired semantics (from the menu plan)

- User intent: “sell item to another project”.
- Backend behavior:
- Step 1: create/update a canonical sale transaction for the source project (`INV_SALE_<sourceProjectId>`) and move item to business inventory.
- Step 2: create/update a canonical purchase transaction for the target project (`INV_PURCHASE_<targetProjectId>`) and allocate item into that project.

### Recommended implementation (ship using existing allocation + designation services)

- Implement `unifiedItemsService.sellItemToProject(...)` as a two-step orchestration using already-shipping primitives:
- Step 1 (source project → business inventory): call `deallocationService.handleInventoryDesignation(accountId, itemId, sourceProjectId, 'inventory')`.
- This creates/updates `INV_SALE_<sourceProjectId>` and moves the item to business inventory state.
- Step 2 (business inventory → target project): call `unifiedItemsService.allocateItemToProject(accountId, itemId, targetProjectId, amount?, notes?, space?)`.
- The allocation logic already handles “item currently in `INV_SALE_*` and allocating to a different project”, creating/updating `INV_PURCHASE_<targetProjectId>` and moving the item into the target project.

- Preconditions to enforce inside `sellItemToProject` before step 1:
- Item exists and is persisted.
- Item is currently in `sourceProjectId`.
- `sourceProjectId != targetProjectId`.
- If the item is tied to a non-canonical transaction, reject with a typed error (match menu plan Rule set C).

- Partial failure semantics (must be explicit and user-visible):
- If step 1 succeeds and step 2 fails, the item is now in business inventory under `INV_SALE_<sourceProjectId>`; return a typed “partial completion” error so UI can guide the user to allocate from business inventory.
- If step 1 fails, treat the operation as failed; caller should refetch.

### Optional hardening (only if we see correctness issues in practice)

- If concurrency/partial-failure issues are unacceptable, add a single Postgres RPC to execute the two-step operation atomically.

## Data model / migrations (if any)

- No schema changes required to ship Sell → Project by composing existing deallocation + allocation services.
- Optional later (hardening): add a migration defining `rpc_sell_item_to_project(...)` (plus an idempotency log table) if we need atomic DB-side orchestration and replay-safe retries.

## Idempotency / concurrency / offline strategy

- Idempotency
- Minimum viable: treat the operation as idempotent if the item already ends in `targetProjectId` with `transaction_id = INV_PURCHASE_<targetProjectId>`.
- Optional later: persist `idempotency_key` server-side via an RPC + log table and return the prior result for replayed keys.
- Concurrency/race conditions
- Two-step service orchestration can conflict under concurrent writes; handle by re-reading item state and surfacing a “refresh and try again” error.
- Optional later: use the RPC hardening for row-level locks and atomicity.
- Partial failure
- Two-step orchestration must return typed errors that allow UI to describe intermediate state when only step 1 completes.
- Offline
- Initial Sell → Project should be unavailable offline.
- If offline support is required later, introduce a new queued operation type (e.g., `SELL_ITEM_TO_PROJECT`) that replays through the RPC when online.

## Implementation steps

1. Document and codify invariants for Sell → Project

- When it is allowed (persisted item, not tied to non-canonical tx)
- Canonical sale/purchase retention semantics (what constitutes “authoritative” history)

2. Add service-layer API

- Add `unifiedItemsService.sellItemToProject(...)` and ensure it is the authoritative entry point used by the UI.
- If you keep a wrapper on `integrationService`, it must be thin and delegate directly to `unifiedItemsService`.
- Ensure it returns stable identifiers needed by UI for navigation/refetch.

3. Implement the backend atomic operation

- First ship without a new DB RPC by composing existing deallocation + allocation flows.
- Only if needed later: add the Supabase migration defining `rpc_sell_item_to_project` for atomicity and replay-safe idempotency.

4. Wire cache invalidation / refresh behavior

- Ensure the caller refreshes the item + both canonical transactions and any business-inventory transaction lists.

5. Decide and implement canonical history policy (if needed)

- If canonical sale must remain a durable record, ensure Sell → Project does not “undo” or delete the source `INV_SALE_<sourceProjectId>` record in a way that breaks historical reporting. Prefer to rely on lineage edges for moved-out visibility where possible.

6. (Optional) Implement “Move To Design Business” as non-sale, if product requires it

- Otherwise, explicitly keep it disabled for transaction-tied items as the plan suggests.

## Test plan

- Unit tests (service orchestration)
- Add tests around `unifiedItemsService.sellItemToProject` ensuring it:
- Calls the correct backend entry point
- Surfaces typed errors correctly
- Triggers expected refetch/invalidation hooks (or returns the right IDs so callers can do so)
- Integration tests (service-level + DB state)
- Add integration coverage that validates end-to-end state transitions using the existing two-step implementation:
- Correct behavior when item is already sold/moved concurrently (one succeeds, one fails with a conflict/error)
- Correct behavior when item is tied to a non-canonical transaction (reject)
- Correct behavior when item is tied to canonical purchase/sale (normalize or proceed per chosen policy)
- Transaction + item state and lineage edges reflect the intended history
- Optional later (if RPC is added): add RPC-specific tests for atomicity and idempotency.
- Manual QA scenarios
- Happy path: project item → Sell to project, verify item ends in target project and both canonical transactions reflect expected membership/history.
- Partial-failure simulation (fallback-only): force step 2 to fail and verify UI guidance + item ends in business inventory.
- Concurrency: two users attempt Sell → Project on the same item; one should succeed, the other should get a conflict and a refresh prompt.
- Retry/idempotency: trigger the action twice rapidly; the second should no-op safely.
- Offline: ensure the action is disabled with a clear reason when offline.