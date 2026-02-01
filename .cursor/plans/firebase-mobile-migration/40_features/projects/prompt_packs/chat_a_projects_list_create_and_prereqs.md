# Prompt Pack — Chat A: Projects list + create + prerequisites

## Goal
Produce a parity-grade spec pass for the Projects list and create-project flow, grounded in the existing web app, while noting Firebase migration deltas.

## Outputs (required)
Update or create:
- `40_features/projects/feature_spec.md` (Projects list + create sections)
- `40_features/projects/acceptance_criteria.md` (Projects list + create criteria)
- `40_features/projects/ui/screens/ProjectsList.md` (screen contract)

## Source-of-truth code pointers (parity evidence)
- Routes: `src/App.tsx`, `src/utils/routes.ts`
- Projects list + modal trigger + list states: `src/pages/Projects.tsx`
- Project form (validation + image selection/upload): `src/components/ProjectForm.tsx`
- Offline prerequisites gating:
  - `src/hooks/useOfflinePrerequisites.ts`
  - `src/components/ui/OfflinePrerequisiteBanner.tsx`
- Project create + offline queue + optimistic id: `projectService.createProject` in `src/services/inventoryService.ts`
- Offline hydration helpers: `hydrateProjectsListCache` in `src/utils/hydrationHelpers.ts`

## Cross-cutting constraints
- Offline-first + change-signal + delta sync: `40_features/sync_engine_spec.plan.md`
- Entitlements gating model: `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include one of:
- **Parity evidence**: “Observed in …” with file + component/function name, or
- **Intentional delta**: explain what changes and why.

## What to capture (minimum)
- Exact list states (loading/empty/offline/error)
- Cache hydration semantics (avoid empty flashes)
- Create flow stages (local-first, pending, image upload timing)
- Prerequisite gating (which caches, what user sees when blocked)
- Firebase entitlements delta:
  - callable `createProject`
  - offline policy choice for over-limit creates

