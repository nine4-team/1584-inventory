# Reports + share/print (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **project reports**:

- Invoice
- Client summary
- Property management summary

…grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Generate reports from project data (invoice + summaries)
- Share/print reports on mobile (platform-adapted)
- Report navigation/back behavior (uses native back stack; no custom history required)

## Non-scope (for this feature folder)
- Budget + accounting rollups UI (entrypoints into reports only) — `40_features/budget-and-accounting/README.md`
- Invoice import (Amazon/Wayfair PDFs) — `40_features/invoice-import/README.md` (create when specced)
- Pixel-perfect report design / branding beyond parity behaviors

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts**:
  - `ui/screens/ProjectInvoice.md`
  - `ui/screens/ClientSummary.md`
  - `ui/screens/PropertyManagementSummary.md`

## Cross-cutting dependencies (canonical)
- Offline-first invariants + change-signal + delta sync: `40_features/sync_engine_spec.plan.md`
- Business profile (name/logo availability, admin-gated editing): `40_features/settings-and-admin/README.md`
- Canonical vs non-canonical budget category attribution (item-driven model):
  - `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
  - `40_features/project-items/flows/inherited_budget_category_rules.md`

## Parity evidence (web sources)
- Report screens:
  - `src/pages/ProjectInvoice.tsx`
  - `src/pages/ClientSummary.tsx`
  - `src/pages/PropertyManagementSummary.tsx`
- Report entrypoints (Accounting tab) + navigation helpers:
  - `src/pages/ProjectLayout.tsx`
  - `src/hooks/useNavigationContext.ts`
  - `src/hooks/useStackedNavigate.ts` (web-only evidence; not the mobile mechanism)
- Data inputs used by reports (web “realtime” snapshot):
  - `src/contexts/ProjectRealtimeContext.tsx`
  - `src/contexts/BusinessProfileContext.tsx`
  - `src/components/CategorySelect.tsx` (`useCategories`)

