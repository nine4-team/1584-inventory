# Business inventory — plan

## Goal
Produce parity-grade specs for `business-inventory`.

## Inputs to review (source of truth)
- Feature list entry: `40_features/feature_list.md` → **Feature 10: Business inventory** (`business-inventory`)
- Sync engine spec: `40_features/sync_engine_spec.plan.md`
- Shared module reuse rule: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Inventory operations + lineage semantics: `40_features/inventory-operations-and-lineage/README.md`
- Media lifecycle + quota guardrails:
  - `40_features/_cross_cutting/offline_media_lifecycle.md`
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Owned screens (web parity sources)
- `BusinessInventory` — contract required? **yes**
  - why: two-tab workspace shell, high-branching list controls, bulk actions, scroll restoration, refresh semantics.
- Inventory-scope Items module screens — contract required? **delta-only**
  - why: must reuse shared Items module; document the inventory-only configuration and any behavior diffs from `project-items`.
- Inventory-scope Transactions module screens — contract required? **delta-only**
  - why: must reuse shared Transactions module; document the inventory-only configuration and any behavior diffs from `project-transactions`.

## Cross-cutting dependencies (link)
- Offline-first + outbox + delta + change-signal (no large listeners): `40_features/sync_engine_spec.plan.md`
- Shared Items + Transactions modules (non-negotiable reuse): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`
- Inventory operations + lineage (allocate/move/sell/linking invariants): `40_features/inventory-operations-and-lineage/README.md`
- Image gallery/lightbox behavior: `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Screen contracts (required):
- `ui/screens/BusinessInventoryHome.md`
- `ui/screens/BusinessInventoryItemsScopeConfig.md`
- `ui/screens/BusinessInventoryTransactionsScopeConfig.md`

## Prompt packs (copy/paste)
Create `prompt_packs/` with 2–4 slices:
- Slice A: Business inventory home (tabs + refresh + list states + scroll restore)
- Slice B: Inventory items scope config (filters/sorts/grouping/bulk/allocate)
- Slice C: Inventory transactions scope config (filters/sorts/create/edit + receipts + category requirements)

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (pending + restart + reconnect).
- Collaboration behavior is explicit and uses change-signal + delta (no large listeners).
- Cross-links are complete (business-inventory ↔ shared module rule ↔ inventory operations ↔ media lifecycle ↔ sync engine spec).

