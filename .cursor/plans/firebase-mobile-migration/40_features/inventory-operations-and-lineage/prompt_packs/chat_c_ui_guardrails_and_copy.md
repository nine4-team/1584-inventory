# Prompt Pack: UI guardrails + copy for inventory operations

## Goal
Produce parity-grade UI guardrails and user-facing copy for inventory operations (move/sell/allocate) that’s consistent across Item Detail, Transactions, and list contexts, and compatible with offline-first behavior.

## Outputs (required)
Update/create only these docs:
- `40_features/inventory-operations-and-lineage/feature_spec.md` (guardrails sections only)
- `40_features/inventory-operations-and-lineage/acceptance_criteria.md` (guardrails sections only)
- `40_features/inventory-operations-and-lineage/flows/project_to_business_inventory.md`
- `40_features/inventory-operations-and-lineage/flows/business_inventory_to_project_allocation.md`
- `40_features/inventory-operations-and-lineage/flows/sell_item_to_project.md`

Also ensure cross-links remain correct:
- `40_features/project-items/flows/inherited_budget_category_rules.md`

## Source-of-truth code pointers
- Item actions + disabled reasons:
  - `src/components/items/ItemActionsMenu.tsx`
- Item Detail action handlers + errors:
  - `src/pages/ItemDetail.tsx`
- Project items list / disposition behavior:
  - `src/pages/InventoryList.tsx` (`updateDisposition`, deallocation trigger)
- Business inventory allocation behavior:
  - `src/pages/BusinessInventory.tsx` (`handleMoveToProject`)
- Transaction detail item actions:
  - `src/pages/TransactionDetail.tsx` (move/sell item dialogs and error handling)

## What to capture (required)
- Guardrails that block actions (transaction-attached items, canonical constraints, missing budget-category inheritance)
- Consistent copy for disabled reasons and error toasts
- Offline messaging expectations (queued ops vs blocked flows)

## Evidence rule (anti-hallucination)
For each non-obvious behavior:
- Provide **parity evidence** (file + component/function), OR
- Mark as an **intentional delta** and explain why.

## Constraints / non-goals
- Don’t add new UI features; capture behavior and copy where ambiguity would otherwise create drift.
