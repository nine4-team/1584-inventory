# Prompt Pack — Chat C: Offline + collaboration + entitlements deltas (Projects)

## Goal
Refine the projects spec specifically for the Firebase mobile target:
- offline-first behaviors (pending, restart, reconnect),
- collaboration freshness without large listeners (change-signal + delta),
- entitlements gating for create project (callable Function + offline policy).

## Outputs (required)
Update:
- `40_features/projects/feature_spec.md` (Offline-first, Collaboration, Entitlements sections)
- `40_features/projects/acceptance_criteria.md` (Offline/collab/entitlements criteria)

Optionally (only if needed for clarity):
- `40_features/projects/ui/screens/ProjectsList.md`
- `40_features/projects/ui/screens/ProjectLayout.md`

## Source-of-truth references
- Migration architecture: `40_features/sync_engine_spec.plan.md`
- Entitlements gating: `40_features/_cross_cutting/billing-and-entitlements.md`

Web parity references (for what exists today)
- Offline create fallback + optimistic id: `projectService.createProject` in `src/services/inventoryService.ts`
- Offline hydration: `src/utils/hydrationHelpers.ts` + `src/contexts/ProjectRealtimeContext.tsx`
- Web “realtime”: `projectService.subscribeToProjects` in `src/services/inventoryService.ts` and `ProjectRealtimeContext` subscriptions

## Evidence rule (anti-hallucination)
For each non-obvious behavior, include one of:
- **Parity evidence**: “Observed in …” with file + component/function name, or
- **Intentional delta**: explain what changes and why.

## Required decisions to make explicit
- Entitlements enforcement:
  - Disallow direct client project creates.
  - Callable `createProject` verifies membership/role and enforces `maxProjects`.
- Offline policy for create:
  - Choose Option A (block over-limit create while offline) or Option B (local draft).
  - If Option A: define UX when offline and gating is unknown.
  - If Option B: define how drafts are represented, reconciled, and what happens on denial.
- Collaboration freshness:
  - One listener per active project on `meta/sync`
  - Delta fetch + apply, including delete tombstones

