## Goal
Produce parity-grade specs for `inventory-operations-and-lineage`.

## Inputs to review (source of truth)
- Feature map entry: `40_features/feature_list.md` → **Feature 8: Cross-entity “inventory operations”** (`inventory-operations-and-lineage`)
- Sync engine spec: `40_features/sync_engine_spec.plan.md` (local-first + outbox + delta sync + change-signal)
- Shared Items + Transactions module rule: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Budget-category inheritance rules (must remain consistent): `40_features/project-items/flows/inherited_budget_category_rules.md`

Web parity evidence sources (key):
- Canonical transaction ids + deterministic multi-entity flows:
  - `src/services/inventoryService.ts` (`allocateItemToProject`, `sellItemToProject`, `moveItemToBusinessInventory`, `deallocationService.handleInventoryDesignation`)
  - `src/services/operationQueue.ts` (`executeDeallocateItemToBusinessInventory`, `executeAllocateItemToProject`, `executeSellItemToProject`, `verifyCanonicalInvariants`)
  - `src/types/operations.ts` (operation types + payload shapes)
- UI entrypoints for these operations:
  - `src/pages/ItemDetail.tsx` (sell/move to BI, sell to project)
  - `src/pages/InventoryList.tsx` (disposition -> inventory triggers deallocation; assign/unlink to transaction)
  - `src/pages/BusinessInventory.tsx` (allocate to project; disposition -> inventory triggers deallocation)
  - `src/pages/TransactionDetail.tsx` (item-level move/sell actions)
  - `src/components/items/ItemActionsMenu.tsx` (disabled reasons + guardrails like “move the transaction instead”)
- Lineage edges + pointers:
  - `src/services/lineageService.ts` (`appendItemLineageEdge`, `updateItemLineagePointers`, `subscribeToItemLineageForItem`)

## Owned flows (list)
- **Project → Business Inventory**
  - “Move to business inventory” (correction path; no canonical sale)
  - “Sell to business inventory” / “Set disposition = inventory” (canonical deallocation; creates/updates `INV_SALE_<projectId>` unless purchase-reversion)
- **Business Inventory → Project**
  - Allocate/move to project (canonical purchase; creates/updates `INV_PURCHASE_<projectId>`)
- **Project → Project**
  - Sell item to another project (two-phase: deallocate then allocate; `INV_SALE_<sourceProjectId>` + `INV_PURCHASE_<targetProjectId>`)
- **Lineage**
  - Append lineage edges and maintain pointers for moves across canonical/non-canonical transactions and inventory (null)

## Cross-cutting dependencies (link)
- `40_features/sync_engine_spec.plan.md` (server-owned invariants + idempotency + outbox)
- `40_features/project-items/flows/inherited_budget_category_rules.md` (required guardrails; destination category prompt in BI → Project)
- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` (shared UI primitives rule)

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Flows (required):
- `flows/project_to_business_inventory.md`
- `flows/business_inventory_to_project_allocation.md`
- `flows/sell_item_to_project.md`
- `flows/lineage_edges_and_pointers.md`

Prompt packs (required):
- `prompt_packs/README.md`
- `prompt_packs/chat_a_multi_entity_ops_and_idempotency.md`
- `prompt_packs/chat_b_lineage_and_visibility.md`
- `prompt_packs/chat_c_ui_guardrails_and_copy.md`

## Prompt packs (copy/paste)
Create `prompt_packs/` with 2–4 slices. Each slice must include:
- exact output files
- source-of-truth code pointers (file paths)
- evidence rule

Recommended slices:
- Slice A: multi-entity ops + idempotency/invariants (Firebase Functions / transactions design)
- Slice B: lineage edges + pointers + visibility cues
- Slice C: UI guardrails + error copy + offline behaviors

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (pending + retries + restart + reconnect) for these multi-entity ops.
- Collaboration behavior is explicit and uses change-signal + delta (no large listeners).
- Cross-links are complete (spec ↔ flows ↔ referenced cross-cutting docs).
