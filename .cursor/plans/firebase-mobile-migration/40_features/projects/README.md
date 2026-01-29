# Projects (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **Projects** experience (projects list + per-project shell), grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Browse projects (list, empty/loading/offline states)
- Open a project shell and navigate core tabs (Items, Transactions, Spaces, Budget)
- Create a project (including optional main image)
- Edit a project
- Delete a project
- Refresh a project snapshot and related collections

## Non-scope (for this feature folder)
- Deep specs for tabs’ internal behavior (items/transactions/spaces/budget are separate features)
- Pixel-perfect UI design
- Purchase provider implementation details (Stripe/App Store/Play Billing) — only entitlement enforcement contracts

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts**:
  - `ui/screens/ProjectsList.md`
  - `ui/screens/ProjectLayout.md`

## Cross-cutting dependencies
- Sync architecture constraints (change-signal + delta, local-first): `40_features/sync_engine_spec.plan.md`
- Entitlements gating for create project (Firebase): `40_features/_cross_cutting/billing-and-entitlements.md`

## Parity evidence (web sources)
- Routes/entrypoints: `src/App.tsx`, `src/utils/routes.ts`
- Projects list + create modal: `src/pages/Projects.tsx`
- Project shell (tabs, refresh, edit/delete, reports entrypoints): `src/pages/ProjectLayout.tsx`
- Project form + image upload + prerequisite gating: `src/components/ProjectForm.tsx`, `src/hooks/useOfflinePrerequisites.ts`
- Local-first CRUD + offline queue fallback: `src/services/inventoryService.ts` (`projectService`)
- Snapshot lifecycle + reconnect refresh: `src/contexts/ProjectRealtimeContext.tsx`
- Offline hydration helpers: `src/utils/hydrationHelpers.ts`

