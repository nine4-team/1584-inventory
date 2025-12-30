# Transaction Lineage & History Plan

## Summary
- Preserve immutable provenance for every item by introducing an append-only transaction lineage.
- Clearly display items that are still part of a transaction vs. those that "moved out," across project and business inventory contexts.
- Do not model "progress" or "completion." No canonical/non-canonical categories. No hover interactions.

## Implementation Status
- ✅ Database migration created (012_add_item_lineage.sql)
- ✅ Types added (ItemLineageEdge, Item lineage fields)
- ✅ LineageService created with idempotency checks
- ✅ Conversion helpers updated to map lineage fields
- ✅ Allocation flows integrated (all scenarios A/B/C)
- ✅ Deallocation/return flows integrated
- ✅ TransactionDetail UI updated (In this transaction vs Moved out sections)
- ⏳ Breadcrumb display (pending - can be added later)
- ⏳ Realtime subscriptions (pending - can be added later)
- ✅ Backfill script created (013_backfill_item_lineage.sql)

## Objectives
- Keep an authoritative origin and latest association for each item.
- Record every move between transactions (or into inventory) as an immutable lineage edge.
- Provide simple, consistent UI sections: “In this transaction” and “Moved out,” with neutral badges and dim styling for moved items.
- Ensure allocation/deallocation/return flows append lineage edges and update the latest pointer.

---

## Core concepts
- **Item anchors**
  - `origin_transaction_id` (immutable): transaction id at creation/intake.
  - `latest_transaction_id` (denormalized): transaction id the item is currently associated with; `null` means “currently in business inventory.”
- **Lineage edge (append-only)**
  - Each move of an item appends one record that describes the transition.
  - Single-path invariant (no branching; at most one outgoing edge from a given point for an item).

### Proposed schema (Supabase)
- Table: `item_lineage_edges`
  - `id` uuid pk
  - `account_id` text not null
  - `item_id` text not null
  - `from_transaction_id` text null           // null == from inventory
  - `to_transaction_id` text null             // null == to inventory
  - `created_at` timestamptz default now()
  - `created_by` text null
  - `note` text null
  - Indexes: `(item_id)`, `(from_transaction_id)`, `(to_transaction_id)`, `(created_at)`, `(account_id, item_id, created_at)`
  - Invariant to enforce in app code: no cycles per item; single-path
- Table: `items` (existing)
  - Add `origin_transaction_id text null`
  - Add `latest_transaction_id text null` (mirrors `items.transaction_id` during transition; ultimately replace or keep both if needed for legacy)
  - Implementation notes:
    - Use consistent types with the existing schema: `account_id` should be `UUID` (references `accounts(id)`), and `created_by` should be `UUID` (references `users(id)`). Keep `item_id` and `transaction_id` as `text` to match existing `items.transaction_id` usage.
    - Add the `item_lineage_edges` table to the `supabase_realtime` publication so clients can subscribe to new edges.
    - Create RLS policies for `item_lineage_edges` mirroring `items`/`transactions` (allow INSERT/SELECT for `is_account_member(account_id)`).

### Integrity & invariants
- Append-only edges; no updates or deletes (except administrative corrections).
- Single-path per item: disallow inserting an edge whose `from_transaction_id` is not the current `latest_transaction_id` for that item.
- No cycles: reject any insertion where `to_transaction_id` appears in the item’s prior path.

---

## UI model 
- **Transaction detail**
  - Section A: “In this transaction” – items with `latest_transaction_id === thisTransactionId`.
  - Section B: “Moved” – items that have an edge with `from_transaction_id === thisTransactionId` while `latest_transaction_id !== thisTransactionId`.
  - Visuals for “Moved”: dim card + compact, neutral badge (e.g., “Moved”). Card stays clickable to the current location.
- **Business inventory item detail**
  - Chips: “Original Transaction: {origin transaction}” and “Current Transaction: {current transaction}”.
- **Inventory list & item detail**
  - When an item moves to inventory, show a small badge “Moved to Inventory” where appropriate.
 - **Item detail (anywhere)**
  - In the item metadata section (not under the title), render a compact micro-breadcrumb showing the transaction lineage (e.g., “Project A → Inventory → Project B”). Each breadcrumb node is labeled with the project name or `Inventory` and links to the corresponding transaction. Always display `Original Transaction` and `Current Transaction` using the existing transaction display in the metadata area.

---

## Read/query patterns
- Item history for drawer: `select * from item_lineage_edges where item_id = ? order by created_at asc` and reconstruct the path.
- “In this transaction”: `latest_transaction_id === thisTransactionId`.
- “Moved”: `exists edge with from_transaction_id === thisTransactionId` AND `latest_transaction_id !== thisTransactionId`.
- Transitional logic before edges exist for all items: for project transactions, treat `item.projectId == null` AND `item.previousProjectTransactionId === thisTransactionId` as “moved to inventory.”

---

## Code audit and change plan
This section enumerates the concrete touchpoints that govern allocation, deallocation, returns, and transaction association, and describes the changes needed to append edges and update anchors consistently.

### Types
- File: `src/types/index.ts`
  - Add fields on `Item`: `originTransactionId?: string | null`, `latestTransactionId?: string | null`.
  - Add a new type: `ItemLineageEdge` with the columns defined above.
  - Keep `previousProjectTransactionId`/`previousProjectId` during transition; plan deprecation after backfill.
  - Implementation notes:
    - Update the item conversion helpers in `src/services/inventoryService.ts` (`_convertItemFromDb` and `_convertItemToDb`) to map `origin_transaction_id` and `latest_transaction_id`.
    - Define `ItemLineageEdge` with typed `createdAt: string` (or Date in app types) and `createdBy?: string | null` (UUID).

### Services (core flows)
- File: `src/services/inventoryService.ts`
  - `unifiedItemsService.allocateItemToProject(...)` (scenario router)
    - Append lineage edge: `from = current item.transactionId (or null)`, `to = resulting transaction id (purchase)`.
    - Update `latest_transaction_id` on item to the new transaction id.
    - Ensure the specific helpers below also perform the append + update consistently.
  - Implementation notes and guardrails:
    - Create a single centralized helper (e.g., `appendItemLineageEdge({ accountId, itemId, from, to, note, createdBy })`) and call it only from higher-level orchestrators (allocation, deallocation, return, completion) after the final state change. This avoids double-logging when lower-level helpers like `addItemToTransaction` or `removeItemFromTransaction` are invoked by multiple flows.
    - Do NOT append edges inside low-level helpers `addItemToTransaction(...)` or `removeItemFromTransaction(...)` to prevent duplicate edges.
    - Implement a lightweight idempotency check in the helper: skip insert when `from === to` or when the latest existing edge for the item matches the same `from`/`to` within a short time window. Consider a unique constraint on `(account_id, item_id, from_transaction_id, to_transaction_id, date_bucket)` or an upsert strategy for the short term.
    - When updating the item pointer, keep `latest_transaction_id` in sync with `items.transaction_id` (denormalized), or choose to rely solely on `items.transaction_id` if you prefer a single source of truth — be explicit in the rollout.

  - Helpers invoked by allocation scenarios
    - `handleSaleToInventoryMove(...)`
    - `handlePurchaseToInventoryMove(...)`
    - `handlePurchaseToDifferentProjectMove(...)`
    - `handleInventoryToPurchaseMove(...)`
    - For each helper, after mutating the item/transactions, append a lineage edge that reflects the logical move and set `latest_transaction_id` accordingly.

  - Bulk allocation
    - `batchAllocateItemsToProject(...)`: after each item’s movement, append the corresponding edge and update `latest_transaction_id`.

  - Returns / deallocation
    - `returnItemFromProject(...)`
    - `handleNewReturn(...)`
    - Append lineage edges for: project purchase → inventory (to null), or project purchase → sale (if using a sale record for the return), mirroring the actual transaction linkage you persist; then set `latest_transaction_id` appropriately (null if inventory).
    - Note: Some existing flows perform a "purchase-reversion" (remove from INV_PURCHASE and return to inventory without creating an INV_SALE). In those cases append a single edge `from=INV_PURCHASE_x, to=null` and set `latest_transaction_id=null`.

  - Transaction-level item mutations
    - `addItemToTransaction(...)` and `removeItemFromTransaction(...)`: these mutate association and amounts; the caller must be responsible for appending a single lineage edge representing the net state change (avoid double-logging).

  - Status changes completing transactions
    - `completePendingTransaction(...)`: if this changes which transaction an item is associated with (e.g., clearing `transactionId` for sales), append a lineage edge (sale → inventory/null) and update `latest_transaction_id`.
    - Important behavioral fix: when completing an `INV_SALE_<projectId>` (a sale that moved items to business inventory) do NOT mark those items as `inventoryStatus: 'sold'`. They should become `inventoryStatus: 'available'` (business inventory available) and have a lineage edge `INV_SALE_<projectId> → null`. Update current `completePendingTransaction` logic accordingly.

  - Previous project linkage (recent addition)
    - Preserve and use `previousProjectTransactionId`/`previousProjectId` as a transitional aid to restore context, but do not rely on it for history once edges are in place.

- File: `src/services/inventoryService.ts` (deallocation integration)
  - `deallocationService.handleInventoryDesignation(...)`
  - `deallocationService.ensureSaleTransaction(...)`
  - After moving the item to inventory and/or writing a sale record, append a lineage edge matching the transition you performed; then set `latest_transaction_id`.

- File: `src/services/inventoryService.ts` (integration facade)
  - `integrationService.allocateBusinessInventoryToProject(...)`
  - `integrationService.returnItemToBusinessInventory(...)`
  - `integrationService.completePendingTransaction(...)`
  - `integrationService.handleItemDeallocation(...)`
  - Ensure these orchestrators call the lower-level functions that perform a single edge append per item move.
  - Implementation notes:
    - Centralize lineage writes in a `lineageService` or a single helper to make it easy to reason about idempotency and ordering.

### Pages (display + triggers)
- File: `src/pages/TransactionDetail.tsx`
  - Split items into “In this transaction” vs “Moved out.”
  - Current heuristic exists for inventory deallocation (checks `item.projectId == null`); augment to use lineage: “Moved out” if an edge exists with `from_transaction_id === thisTransactionId` and `latest_transaction_id !== thisTransactionId`.
  - Keep real-time updates responsive to item updates and new lineage edges.
  - Implementation notes:
    - Implement the following membership logic (guarded by feature flag during rollout):
      - "In this transaction": `item.latestTransactionId === thisTransactionId` (fallback to `item.transactionId === thisTransactionId` until backfill completes).
      - "Moved out": `exists edge where from_transaction_id === thisTransactionId` AND `item.latestTransactionId !== thisTransactionId`. Transitional fallback: `item.projectId == null && item.previousProjectTransactionId === thisTransactionId`.
    - Render moved items dimmed with a neutral badge ("Moved") and keep cards clickable to their current location.

- File: `src/pages/BusinessInventoryItemDetail.tsx`
  - Show the existing transaction metadata fields for “Original Transaction” and “Current Transaction”.
  - Render the compact micro-breadcrumb in the metadata area; nodes link to transactions.
  - Ensure the general `ItemDetail` page also renders the same compact breadcrumb in its metadata area.

- Files: `src/pages/InventoryList.tsx`, `src/pages/ItemDetail.tsx`, `src/pages/BusinessInventory.tsx`
  - After disposition flips to inventory (deallocation) or allocation to a project, ensure list chips/badges reflect the changed category and navigation routes to the current location.

- Component: `src/components/ui/TransactionAudit.tsx` (untracked in repo)
  - Evolve into a reusable compact breadcrumb renderer backed by `item_lineage_edges`.

### Realtime
- File: `src/hooks/useRealtime.ts`
  - Subscribe to `items` (for `latest_transaction_id` changes) and `item_lineage_edges` inserts.
  - On new edge or item update, recompute section membership on any open transaction detail view.
  - Implementation notes:
    - Add `item_lineage_edges` to the `supabase_realtime` publication in migrations.
    - Extend existing subscription helpers (e.g., `subscribeToBusinessInventory`) or add a lightweight `subscribeToItemLineage(accountId, callback)` that listens for inserts on `item_lineage_edges` filtered by `account_id`.

---

## Migration and backfill
1. Add `item_lineage_edges` table + indexes + RLS in Supabase.
2. Add `origin_transaction_id`, `latest_transaction_id` columns to `items`.
3. Backfill anchors:
   - `origin_transaction_id` = earliest known transaction for the item (fallback: current if none else known; can be null for legacy inventory-only items).
   - `latest_transaction_id` = existing `items.transaction_id` at migration time (null → inventory).
4. Seed minimal edges (optional but recommended):
   - Where `previousProjectTransactionId` exists and current `transactionId` exists, insert one edge `previous → current`.
   - Where `previousProjectTransactionId` exists and current `transactionId` is null, insert `previous → null` (to inventory).
5. Update service code to append edges for every move and keep `latest_transaction_id` in sync.
6. Transitional reads:
   - TransactionDetail “Moved” section uses lineage when present; falls back to existing heuristics until backfill is complete.
7. After validation, plan deprecation of `previousProjectTransactionId`/`previousProjectId` if redundant.
  - Implementation notes and specifics:
    - Use UUID for `account_id` and `created_by` in the new migrations to match existing schema.
    - After creating the `item_lineage_edges` table, add it to the `supabase_realtime` publication so clients can subscribe to edge inserts.
    - Backfill strategy:
      - Populate `origin_transaction_id` from the earliest transaction association known in `transactions.item_ids` or from `audit_logs` when available.
      - Populate `latest_transaction_id` from the `items.transaction_id` column at migration time.
      - Seed edges conservatively: prefer a single edge per known transition (previous → current or previous → null). Avoid creating noisy duplicate edges.
    - Indexes: ensure `(account_id, item_id, created_at)` and indexes on `from_transaction_id` and `to_transaction_id` for efficient queries.

---

## Test plan (targeted, no progress semantics)
- Inventory → Project (allocation): edge appended `null → purchase`, `latest_transaction_id` = purchase.
- Project → Inventory (deallocation/return): edge `purchase → null`, `latest_transaction_id` = null; TransactionDetail shows card as “Moved to Inventory.”
- Project A → Project B (reallocation via inventory or direct sale/purchase pair): edges reflect the sequence; A’s transaction shows the item dimmed in “Moved out,” B’s shows in “In this transaction.”
- Real-time: both sections update on edge insert and on item latest pointer updates.
- Idempotency: repeated user action doesn’t duplicate edges.
  - Add tests for the centralized `appendItemLineageEdge` helper to ensure idempotency and single-path invariants under concurrent calls.

---

## Risks and mitigations
- Edge duplication: guard with unique key `(account_id, item_id, from_transaction_id, to_transaction_id, created_at bucket)` or perform upsert with a short time window.
- Cycle prevention: validate on insert by scanning the prior path for `to_transaction_id` (bounded by item’s edge count; consider a server-side function if needed).
- Partial writes: wrap “mutation + edge append + latest pointer update” in a service-level transactional sequence (best-effort in client; if server-side functions exist, move logic there).
- Performance: add covering indexes; cache/reuse the latest edge ids client-side where appropriate.
  - Additional mitigations:
    - Implement an application-level idempotency guard in the lineage helper and strong uniqueness/indexing in the DB to reduce duplicates.
    - For strict single-path enforcement and cycle prevention, consider a Postgres RPC (or trigger) that validates the new edge against the existing path and performs the item update + edge insert atomically.

---

## Concrete references (current code, for implementers)
- Allocation scenario router
```1559:1643:src/services/inventoryService.ts
async allocateItemToProject(...) {
  // scenarios A/B/C leading to helpers such as handleSaleToInventoryMove, handlePurchaseToInventoryMove, ...
}
```

- Deallocation to inventory (designation)
```2834:2941:src/services/inventoryService.ts
deallocationService.handleInventoryDesignation(...)
```

- Return flows
```2329:2383:src/services/inventoryService.ts
async returnItemFromProject(...) { ... }
async handleNewReturn(...) { ... }
```

- Bulk allocation
```2226:2316:src/services/inventoryService.ts
async batchAllocateItemsToProject(...) { ... }
```

- Transaction detail: current deallocation check
```891:897:src/pages/TransactionDetail.tsx
const isDeallocated = item.projectId == null
```

- Inventory/User pages triggering deallocation
```110:141:src/pages/InventoryList.tsx
if (newDisposition === 'inventory') {
  await integrationService.handleItemDeallocation(...)
}
```
```218:233:src/pages/ItemDetail.tsx
if (newDisposition === 'inventory') {
  await integrationService.handleItemDeallocation(...)
}
```

---

## Rollout outline
1. Ship schema changes (edges table + anchors) behind a feature flag in the app config.
2. Backfill anchors and minimal edges; enable lineage reads in TransactionDetail guarded by the flag.
3. Update services to append edges and keep latest pointer; validate on staging with live flows.
4. Add UI badges/sections and history drawer.
5. Enable real-time subscriptions on edges; test collaborative scenarios.
6. Remove the flag and, if desired later, deprecate transitional columns.
  - Feature flag specifics:
    - Use a Vite environment flag `VITE_ENABLE_ITEM_LINEAGE` (default `false` during rollout). Gate both reads (TransactionDetail / breadcrumbs) and writes (lineage append helper) behind this flag until backfill and testing complete.

---

## Outcome
- Every item has an immutable, inspectable history of transaction associations.
- Transaction views can consistently show what is “in” vs. what has “moved out,” without introducing progress or completion concepts.
- Allocation/deallocation/returns are auditable and predictable via append-only edges and a simple latest pointer.


