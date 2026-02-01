# Work order: `projects` parity spec set

This work order produces the **canonical** feature spec set for `40_features/projects/`, aligned to the current Ledger web app behavior and compatible with the React Native + Firebase **offline-first + delta sync + change-signal** constraints.

---

## Goal
Create parity-grade specs for the `projects` workspace shell (projects list + project shell layout), including offline behaviors and the net-new **Firebase entitlements gating** model for project creation.

## Inputs to review (source of truth)

### Parity evidence (existing web code)
- Routing + entrypoints: `src/App.tsx`, `src/utils/routes.ts`
- Projects list + create modal: `src/pages/Projects.tsx`
- Project shell (tabs, refresh, edit/delete, reports entrypoints): `src/pages/ProjectLayout.tsx`
- Project create/edit form + image upload + prerequisite gating: `src/components/ProjectForm.tsx`, `src/hooks/useOfflinePrerequisites.ts`
- Local-first project CRUD + offline queue fallback:
  - `projectService.{getProjects,getProject,createProject,updateProject,deleteProject,subscribeToProjects}` in `src/services/inventoryService.ts`
- “Realtime” snapshot lifecycle (online subscriptions + offline cache hydration + refresh on reconnect/sync complete):
  - `src/contexts/ProjectRealtimeContext.tsx`
- Cache hydration helpers used by Projects + ProjectLayout:
  - `hydrateProjectsListCache`, `hydrateProjectCache` in `src/utils/hydrationHelpers.ts`

### Architecture constraints (migration)
- Offline-first invariants + change-signal + delta sync: `40_features/sync_engine_spec.plan.md`

### Cross-cutting dependencies (migration)
- Billing + entitlements gating (create project): `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`

## Owned screens (contracts required)
- `ProjectsList` — **yes** — offline list states + create gating + optimistic/pending semantics are easy to get wrong.
- `ProjectLayout` — **yes** — refresh/offline/error semantics and “shell” navigation shape correctness/cost.

## Output files (this work order produces)

Minimum:
- `40_features/projects/README.md`
- `40_features/projects/feature_spec.md`
- `40_features/projects/acceptance_criteria.md`

Screen contracts (required):
- `40_features/projects/ui/screens/ProjectsList.md`
- `40_features/projects/ui/screens/ProjectLayout.md`

Prompt packs (required):
- `40_features/projects/prompt_packs/README.md`
- `40_features/projects/prompt_packs/<2-3 packs>.md`

## Done when (quality gates)
- Acceptance criteria all have **parity evidence** (file + component/function) or are labeled **intentional deltas**.
- Offline behaviors are explicit (pending UI, restart behavior, reconnect behavior).
- Collaboration behavior is explicit and uses **change-signal + delta** (no large listeners).
- Entitlements gating for create project is explicit and references the cross-cutting doc.

