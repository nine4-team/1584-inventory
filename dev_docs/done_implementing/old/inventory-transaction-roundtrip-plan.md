# Inventory Transaction Round-Trip Refactor Plan

## Summary
- Items returned from a project purchase now preserve their original project transaction linkage while they live in business inventory.
- When those items are reallocated back to the same project, the service attempts to restore the original purchase transaction automatically, keeping category totals accurate.
- The Supabase schema tracks this via new nullable columns so the linkage survives across inventory round-trips.

## Current Behavior
- `handleNewReturn()` (triggered by `returnItemFromProject`) writes the item into the canonical `INV_SALE_<projectId>` transaction and overwrites `item.transactionId` with that sale id, without preserving the original project purchase transaction.
- `handleSaleToInventoryMove()` (Scenario A.1 in `allocateItemToProject`) subsequently removes the item from the sale transaction and explicitly sets `transactionId: null`, leaving nothing to restore.  
  ```1430:1586:src/services/inventoryService.ts
  await this.updateItem(accountId, itemId, {
    projectId: _projectId,
    inventoryStatus: 'allocated',
    transactionId: null,
    disposition: 'keep',
    space: space ?? ''
  })
  ```

## Goals
- Maintain an authoritative link to the original project purchase transaction for items that temporarily live in business inventory.
- Automatically restore the original transaction (and its budget category/tax context) when the item returns to the originating project.
- Preserve backward compatibility for items that never had an original project transaction.

## Implementation Notes
- **Schema (Supabase `items` table`)**
  - Migration `supabase/migrations/20251109_add_previous_project_columns.sql` adds nullable `previous_project_transaction_id` and `previous_project_id` columns plus supporting indexes.
  - Columns are only populated for future deallocations; historical data remains untouched.
- **Service updates (`unifiedItemsService` / `deallocationService`)**
  - `handleReturnFromPurchase` and `handleNewReturn` capture the current `INV_PURCHASE_<projectId>` transaction (when present) before redirecting the item into the canonical `INV_SALE_<projectId>` return flow.
  - `deallocationService.handleInventoryDesignation` mirrors this capture path for UI-triggered inventory designations, ensuring both automated and manual flows persist the previous transaction metadata.
  - On reallocation via Scenario A.1 (`handleSaleToInventoryMove` and the batch allocation path), the helper `_restoreItemAfterSaleRemoval` attempts to rejoin the original purchase transaction when the stored project id matches the allocation target. On success the previous-* fields are cleared; if the stored purchase is missing or mismatched we fall back to the current behavior and clear the stale pointers.
  - All other allocation scenarios explicitly clear the previous-* fields to avoid carrying invalid references across projects.
- **Audit trail**
  - Allocation logs now record `restoration_status` and (when relevant) `restored_transaction_id` to make the round-trip behavior observable in support tooling.
- **UI / Types**
  - `Item` type includes optional `previousProjectTransactionId` / `previousProjectId` fields.
  - `BusinessInventoryItemDetail` renders the preserved “Original Transaction” link when present so support can confirm the link from the detail view.
- **Testing**
  - Service-level round-trip tests were drafted to exercise restoration, missing-transaction fallback, and cross-project reallocation. (Note: the broader Vitest suite still requires the existing jsdom canvas shim to pass; coordinate before enabling in CI.)

## Current Status (2025‑11‑09)
- Returning items to business inventory is still not persisting `previous_project_transaction_id` / `previous_project_id` in production.
- Live deallocation run produced the following console trace; observe the item update without previous-* fields being set:
  ```
  📦 Moving item to business inventory...
  inventoryService.ts:725 Transactions change received (account scope)! { ... eventType: 'UPDATE', amount: '52.00', ... }
  inventoryService.ts:1158 Project items change received (broad filter)! { ... eventType: 'UPDATE', id: '23b3159d-f31f-4ebe-9e8f-a699345e6153', ... }
  InventoryList.tsx:41 🔍 InventoryList - propItems changed: 7
  inventoryService.ts:48 📋 Audit logged: deallocation for item I-8af43212-a3a4-4aa8-ab53-df2c167f858f
  inventoryService.ts:2801 ✅ Item moved to business inventory successfully
  inventoryService.ts:2803 ✅ Deallocation completed successfully
  ```
- Another engineer should revisit the capture logic; current behavior suggests the service update isn’t writing to the new columns despite the schema being in place.

## Risks & Mitigations
- **Data drift**: Original transaction might be deleted while item sits in inventory.  
  _Mitigation_: Detect missing transaction and clear stored metadata, emit warning.
- **Concurrent moves**: Simultaneous operations on the same item could race.  
  _Mitigation_: Reuse existing sequential service patterns; add optimistic locking if needed.
- **Migration impact**: Adding columns requires coordinated Supabase migration.  
  _Mitigation_: Ship migration script alongside code change; mark columns nullable to avoid downtime.

## Open Questions
- Should we persist additional context (e.g., amount snapshot, budget category) to handle transaction edits that occur while the item is in inventory?
- Do we need a UI indicator showing the original transaction will be restored on reallocation?

## Next Steps
- Draft Supabase migration for new columns.
- Implement service changes outlined above.
- Add regression tests for round-trip flows.
- Validate on staging with real round-trip scenario before releasing.
### Implementation Details (binding to current code)
- Function name alignment
  - Capture previous transaction on return in:
    - `unifiedItemsService.returnItemFromProject(...)`
    - `unifiedItemsService.handleNewReturn(...)`
    - Ensure capture also occurs for flows initiated by `deallocationService.handleInventoryDesignation(...)` which may call `deallocationService.ensureSaleTransaction(...)`.
  - Restore previous transaction on reallocation in:
    - `unifiedItemsService.batchAllocateItemsToProject(...)` (Scenario A.1 path after removing from `INV_SALE_<projectId>` when reassigning to the same project).

- Schema (Supabase)
  - Columns: `previous_project_transaction_id text null`, `previous_project_id text null`
  - Index: `create index if not exists idx_items_previous_project_transaction_id on items(previous_project_transaction_id);`
  - Optional index: `create index if not exists idx_items_previous_project_id on items(previous_project_id);`
  - RLS: ensure the `items` update policy continues to cover the new columns (policy already checks owner account, so no new predicate was required).
  - Migration file: `supabase/migrations/20251109_add_previous_project_columns.sql`

- Types and mapping
  - `src/types/index.ts` → extend `Item`:
    - `previousProjectTransactionId?: string | null`
    - `previousProjectId?: string | null`
  - `src/services/inventoryService.ts`:
    - `_convertItemFromDb`: map `previous_project_transaction_id` → `previousProjectTransactionId`, `previous_project_id` → `previousProjectId`
    - `_convertItemToDb`: map `previousProjectTransactionId` → `previous_project_transaction_id`, `previousProjectId` → `previous_project_id`

- Service logic specifics
  - Capture: when returning an item from a project and the current `transactionId` starts with `INV_PURCHASE_`, persist that id and project into the new previous‑ fields before switching the item to `INV_SALE_<projectId>`.
  - Restore: on A.1 (sale → same project) reallocation, if `previous_project_id === targetProjectId` and the referenced transaction exists:
    - Add the item to `transactions.item_ids`
    - Set `item.transactionId` back to the stored project purchase transaction
    - Clear both previous‑ fields
  - Fallback: if the stored transaction is missing or mismatched, proceed with current behavior and clear previous‑ fields to avoid stale pointers.
  - Logging: use `auditService.logAllocationEvent(...)` to include `{ restored_transaction_id: <id> }` on successful restore and warnings on fallbacks.

- UI alignment
  - `src/pages/BusinessInventoryItemDetail.tsx`: bind the “Original Transaction” display to `previousProjectTransactionId` (linked) and hide when absent. Leave “Transaction” unchanged.

- Tests (Vitest)
  - Add `src/services/__tests__/inventory-roundtrip.test.ts` covering:
    1) Restore on round‑trip to same project and clearing previous‑ fields  
    2) Missing transaction fallback and clearing previous‑ fields  
    3) Different‑project reallocation ignoring stored transaction and clearing previous‑ fields
