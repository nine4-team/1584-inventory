# Business inventory (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **Business inventory** workspace (inventory Items + inventory Transactions), grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Business inventory workspace shell (tabs, refresh, list state restoration)
- Inventory-scope Items experience (list/search/filter/sort/group, bulk selection + bulk actions)
- Inventory-scope Transactions experience (list/search/filter/sort, create/edit, receipts/media)
- Allocation entrypoints from inventory → project (links to inventory-ops semantics)

## Non-scope (for this feature folder)
- Deep specs for shared Items/Transactions behavior that already exists in:
  - `40_features/project-items/` (canonical Items module contract)
  - `40_features/project-transactions/` (canonical Transactions module contract)
- Deep semantics for multi-entity inventory operations (allocate/move/sell/deallocate/linking/lineage):
  - `40_features/inventory-operations-and-lineage/README.md`
- Pixel-perfect UI design

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts (deltas/config only)**:
  - `ui/screens/BusinessInventoryHome.md`
  - `ui/screens/BusinessInventoryItemsScopeConfig.md`
  - `ui/screens/BusinessInventoryTransactionsScopeConfig.md`

## Cross-cutting dependencies
- Sync architecture constraints (change-signal + delta, local-first): `40_features/sync_engine_spec.plan.md`
- Shared Items + Transactions modules (non-negotiable reuse): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Inventory operations + lineage (allocate/move/sell/linking invariants): `40_features/inventory-operations-and-lineage/README.md`
- Offline media lifecycle + quota guardrails:
  - `40_features/_cross_cutting/offline_media_lifecycle.md`
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`
- Image gallery/lightbox behavior: `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

## Parity evidence (web sources)
- Business inventory workspace (tabs, list controls, bulk actions, scroll restoration, refresh):
  - `src/pages/BusinessInventory.tsx`
- Business inventory item detail (allocation, assign-to-transaction, images, next/prev navigation with param preservation):
  - `src/pages/BusinessInventoryItemDetail.tsx`
- Business inventory item create/edit:
  - `src/pages/AddBusinessInventoryItem.tsx`
  - `src/pages/EditBusinessInventoryItem.tsx`
- Business inventory transaction create/edit:
  - `src/pages/AddBusinessInventoryTransaction.tsx`
  - `src/pages/EditBusinessInventoryTransaction.tsx`
- Inventory transaction detail (shared detail screen, routed under business inventory):
  - `src/pages/TransactionDetail.tsx`

