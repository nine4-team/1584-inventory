# Prompt Pack — Chat B: ProjectLayout shell + refresh/edit/delete

## Goal
Produce a parity-grade spec pass for the Project shell screen (`ProjectLayout`) focusing on refresh semantics, offline/error states, and edit/delete behaviors.

## Outputs (required)
Update or create:
- `40_features/projects/feature_spec.md` (shell + refresh/edit/delete sections)
- `40_features/projects/acceptance_criteria.md` (shell + refresh/edit/delete criteria)
- `40_features/projects/ui/screens/ProjectLayout.md` (screen contract)

## Source-of-truth code pointers (parity evidence)
- Shell layout + tabs + refresh/edit/delete: `src/pages/ProjectLayout.tsx`
- Project routes: `src/App.tsx`, `src/utils/routes.ts`
- Snapshot lifecycle (offline hydrate + reconnect refresh + post-sync refresh): `src/contexts/ProjectRealtimeContext.tsx`
- Project CRUD (update/delete offline fallback): `projectService.updateProject`, `projectService.deleteProject` in `src/services/inventoryService.ts`
- Project cache hydration: `hydrateProjectCache` in `src/utils/hydrationHelpers.ts`

## Cross-cutting constraints
- Offline-first + change-signal + delta sync: `40_features/sync_engine_spec.plan.md`

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include one of:
- **Parity evidence**: “Observed in …” with file + component/function name, or
- **Intentional delta**: explain what changes and why.

## What to capture (minimum)
- Loading/error/offline/not-found states and exact messaging
- Refresh semantics (what collections, in-flight disablement, error toast)
- Offline hydrate behavior (avoid infinite retry)
- Reconnect + post-outbox-refresh behavior
- Edit flow (prefill, image handling, refresh-after-save)
- Delete flow (confirm dialog, failure handling)

