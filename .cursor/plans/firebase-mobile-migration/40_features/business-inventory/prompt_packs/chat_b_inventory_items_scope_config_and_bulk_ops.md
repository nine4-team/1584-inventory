# Prompt Pack — Chat B: Inventory items scope config (filters/sorts/grouping/bulk/allocate)

## Goal
Produce a parity-grade spec pass for **inventory-scope Items** in the Business inventory workspace, focusing on list controls, duplicate grouping, bulk actions, and allocation entrypoints, while ensuring the spec does **not** imply a forked module.

## Outputs (required)
Update or create:
- `40_features/business-inventory/feature_spec.md` (inventory items sections)
- `40_features/business-inventory/acceptance_criteria.md` (inventory items criteria)
- `40_features/business-inventory/ui/screens/BusinessInventoryItemsScopeConfig.md` (scope config contract)

## Source-of-truth code pointers (parity evidence)
- Inventory items list (filters/sorts/grouping/bulk actions/QR gating):
  - `src/pages/BusinessInventory.tsx`
- Inventory item detail (allocation + transaction assignment + next/prev navigation + images):
  - `src/pages/BusinessInventoryItemDetail.tsx`
- Inventory item create/edit (quantity, validation, offline errors, save-time defaults):
  - `src/pages/AddBusinessInventoryItem.tsx`
  - `src/pages/EditBusinessInventoryItem.tsx`

## Cross-cutting constraints
- Shared module reuse rule (must reuse Items module): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Canonical Items behavior/contracts (project entrypoint, reused by inventory): `40_features/project-items/README.md`
- Inventory operations correctness: `40_features/inventory-operations-and-lineage/README.md`
- Offline media lifecycle + quota guardrails:
  - `40_features/_cross_cutting/offline_media_lifecycle.md`
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include one of:
- **Parity evidence**: “Observed in …” with file + component/function name, or
- **Intentional delta**: explain what changes and why.

## What to capture (minimum)
- Inventory-scope filter/sort/search keys and allowed values
- Duplicate grouping rules and how selection behaves with groups
- Bulk allocate flow (project selection + optional space) and offline behavior
- QR generation feature-flag behavior

