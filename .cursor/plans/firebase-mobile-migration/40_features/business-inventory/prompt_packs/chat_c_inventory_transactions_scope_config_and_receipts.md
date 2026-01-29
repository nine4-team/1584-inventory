# Prompt Pack — Chat C: Inventory transactions scope config (filters/sorts/create/edit + receipts)

## Goal
Produce a parity-grade spec pass for **inventory-scope Transactions** in the Business inventory workspace, focusing on list controls and create/edit requirements (category required, receipts/media offline placeholders), while ensuring the spec does **not** imply a forked module.

## Outputs (required)
Update or create:
- `40_features/business-inventory/feature_spec.md` (inventory transactions sections)
- `40_features/business-inventory/acceptance_criteria.md` (inventory transactions criteria)
- `40_features/business-inventory/ui/screens/BusinessInventoryTransactionsScopeConfig.md` (scope config contract)

## Source-of-truth code pointers (parity evidence)
- Inventory transactions list (filters/sorts/search, navigation to detail):
  - `src/pages/BusinessInventory.tsx`
- Inventory transaction create/edit (category required, projectId null, offline-aware receipts):
  - `src/pages/AddBusinessInventoryTransaction.tsx`
  - `src/pages/EditBusinessInventoryTransaction.tsx`
- Transaction detail (shared):
  - `src/pages/TransactionDetail.tsx`

## Cross-cutting constraints
- Shared module reuse rule (must reuse Transactions module): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Canonical Transactions behavior/contracts (project entrypoint, reused by inventory): `40_features/project-transactions/README.md`
- Offline media lifecycle + quota guardrails:
  - `40_features/_cross_cutting/offline_media_lifecycle.md`
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include one of:
- **Parity evidence**: “Observed in …” with file + component/function name, or
- **Intentional delta**: explain what changes and why.

## What to capture (minimum)
- Inventory-scope filter keys + allowed values (including `inventory-only` status)
- Category-required behavior and its offline prerequisites
- Receipt upload placeholder behavior and cleanup expectations
- Explicit statement that inventory transactions do not offer CSV export (web parity)

