# Budget + Accounting (project rollups) — Firebase mobile migration feature spec

This folder defines the parity-grade behavior spec for Ledger’s **Project Budget + Accounting rollups** experience, grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

This feature is **project-only**.

## Scope
- Budget tab: per-category budget progress + overall budget progress
- Design fee tracker: “received” progress (special semantics)
- Accounting tab: rollup cards (“owed to business”, “owed to client”) + links to Reports screens
- All rollups computed from **local data** (SQLite) with deterministic canonical attribution (see below)

## Non-scope (for this feature folder)
- Editing budget categories and presets (Settings) — `40_features/settings-and-admin/README.md`
- Full Reports generation/rendering (Invoice / Client Summary / Property Mgmt) — `40_features/reports-and-printing/README.md`
- Inventory operations that create canonical rows (allocation/sale/deallocation/lineage) — `40_features/inventory-operations-and-lineage/README.md`
- Migration/backfill for `inheritedBudgetCategoryId` or category presets (explicitly out of scope)

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Plan / prompt packs**: `plan.md`, `prompt_packs/`

## Cross-cutting dependencies (canonical)
- Sync architecture constraints (change-signal + delta, local-first): `sync_engine_spec.plan.md`
- Canonical vs non-canonical attribution model (source of truth):
  - `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
  - `40_features/project-items/flows/inherited_budget_category_rules.md`

## Parity evidence (web sources)
- Budget progress UI + math (current implementation we are **deviating** from for canonical attribution):
  - `src/components/ui/BudgetProgress.tsx`
  - `src/components/ui/__tests__/BudgetProgress.test.tsx`
- Project budget/accounting tab shell + accounting rollups + report entrypoints:
  - `src/pages/ProjectLayout.tsx`
- Canonical transaction totals are computed from item prices:
  - `src/services/inventoryService.ts` (`computeCanonicalTransactionTotal`, canonical `INV_*` transaction creation/update)
