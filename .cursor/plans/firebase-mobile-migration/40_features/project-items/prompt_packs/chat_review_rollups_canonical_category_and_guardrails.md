# Prompt pack: Review rollups + canonical category + guardrails (Project Items)

You are updating Firebase mobile migration specs. Your task is to review and improve the Project Items spec pack so it is implementation-ready, specifically around:

- Canonical item-driven rollup logic (no new UI)
- Canonical transaction “category” storage decision
- Guardrails applying to **sell/deallocate** but not necessarily “move” corrections

## Context (source of truth)

- Working doc (canonical on this topic): `.cursor/plans/firebase-mobile-migration/00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- Architecture constraints: `.cursor/plans/firebase-mobile-migration/40_features/sync_engine_spec.plan.md`
- Project Items spec pack (your targets):
  - `.cursor/plans/firebase-mobile-migration/40_features/project-items/feature_spec.md`
  - `.cursor/plans/firebase-mobile-migration/40_features/project-items/acceptance_criteria.md`
  - `.cursor/plans/firebase-mobile-migration/40_features/project-items/flows/inherited_budget_category_rules.md`
  - `.cursor/plans/firebase-mobile-migration/40_features/project-items/ui/screens/ProjectItemsList.md`
  - `.cursor/plans/firebase-mobile-migration/40_features/project-items/ui/screens/ItemDetail.md`

## Parity evidence (web app code pointers)

- Budget rollups today: `src/components/ui/BudgetProgress.tsx` (note: uses transaction category fields; canonical sale treated as negative)
- Canonical transactions + move vs sell distinction:
  - Canonical IDs + creation helpers: `src/services/inventoryService.ts`
  - Move correction (no canonical rows): `moveItemToBusinessInventory` in `src/services/inventoryService.ts`
  - Deallocation/sell to business inventory (creates/updates `INV_SALE_*`): `handleItemDeallocation` path in `src/pages/ItemDetail.tsx`, `src/pages/InventoryList.tsx`
- Item actions surface: `src/components/items/ItemActionsMenu.tsx`
- Bulk controls surface: `src/components/ui/BulkItemControls.tsx`

## What to do

1) **Rollup logic requirement (must be explicit)**
   - Ensure specs clearly require *new rollup computation* (no new UI) where:
     - non-canonical attribution uses `transaction.category_id`
     - canonical inventory attribution groups linked items by `item.inheritedBudgetCategoryId`
   - Ensure specs clearly say canonical transaction category must not drive attribution.
   - Add/adjust “Intentional delta” callouts pointing to `BudgetProgress.tsx`.

2) **Canonical transaction category storage recommendation**
   - Decide (and document) the recommended approach:
     - `category_id = null` for canonical rows (preferred), OR
     - hidden/internal “Canonical (system)” category (allowed only if it cannot leak into user attribution).
   - Make the consequences explicit (filters, exports, compatibility).

3) **Guardrail scope: “move” vs “sell/deallocate”**
   - Ensure specs do not incorrectly gate “Move to Design Business” with the `inheritedBudgetCategoryId` requirement, since move is a correction path in current parity code.
   - Ensure the guardrail still applies to:
     - “Sell to Design Business”
     - Disposition → `inventory` deallocation trigger (single + bulk)

## Evidence rule (anti-hallucination)

Every non-obvious behavior you add must include:

- Parity evidence (file + component/function), OR
- Intentional delta (explicitly labeled).

## Output expectations

Make edits directly in the spec pack files listed above. Keep changes narrowly scoped to the four topics above.

