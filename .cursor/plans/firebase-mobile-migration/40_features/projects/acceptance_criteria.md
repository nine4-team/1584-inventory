# Projects — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Projects list
- [ ] **Route parity**: Projects list is reachable at `/projects` and `/` entrypoint.  
  Observed in `src/App.tsx` (routes) and `src/utils/routes.ts` (`projectsRoot`).
- [ ] **Loading state**: While account context and/or projects are loading, show a loading state (no empty-state flash).  
  Observed in `src/pages/Projects.tsx` (`accountLoading || isLoadingData`).
- [ ] **No account guard**: If not loading and there is no `currentAccountId`, show “No Account Selected” with a Settings CTA.  
  Observed in `src/pages/Projects.tsx`.
- [ ] **Empty state**: If there are zero projects, show an empty state with “Create Project” CTA.  
  Observed in `src/pages/Projects.tsx`.
- [ ] **List UI**: Projects render in a grid with name + client name + budget preview, and optional main image.  
  Observed in `src/pages/Projects.tsx` and `src/components/ui/BudgetProgress`.
- [ ] **Open project**: “Open Project” navigates into the project shell (Items tab).  
  Observed in `src/pages/Projects.tsx` (`projectItems(project.id)`).
- [ ] **Offline hydration**: Projects list hydrates from local cache before network fetch to avoid empty flash after restart.  
  Observed in `src/pages/Projects.tsx` (`hydrateProjectsListCache`) and `src/utils/hydrationHelpers.ts`.

## Create project
- [ ] **Entry point**: Create is launched from Projects list (“New” button) into a modal form.  
  Observed in `src/pages/Projects.tsx` and `src/components/ProjectForm.tsx`.
- [ ] **Validation**: `name` and `clientName` are required.  
  Observed in `src/components/ProjectForm.tsx` (`validateForm`).
- [ ] **Offline prerequisites gate**: Form submission is blocked unless required caches are warm (budget categories, tax presets, vendor defaults).  
  Observed in `src/hooks/useOfflinePrerequisites.ts` and `src/components/ProjectForm.tsx` (disables submit when `!isReady` and sets `_prerequisite` error).
- [ ] **Image upload on create**: If a main image is chosen, the project is created first and then the image is uploaded and `mainImageUrl` is patched.  
  Observed in `src/components/ProjectForm.tsx` (post-create image upload) and `projectService.updateProject` in `src/services/inventoryService.ts`.
- [ ] **Offline create (web parity)**: If offline or network create fails, creation is queued for offline sync and returns an optimistic project id.  
  Observed in `projectService.createProject` in `src/services/inventoryService.ts`.
- [ ] **Entitlements enforcement (Firebase)**: Project creation is server-enforced by a callable Function `createProject(...)`; direct client creates are disallowed.  
  **Intentional delta** required by `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`.
- [ ] **Offline policy for entitlements (Firebase)**: Over-limit project creation is blocked while offline; user is prompted to go online/upgrade.  
  **Intentional delta** (defined in `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`).

## Project shell (layout + navigation)
- [ ] **Route parity**: Project shell is mounted at `/project/:projectId/*` and exposes tabs for `items`, `transactions`, `spaces`, `budget`.  
  Observed in `src/App.tsx` and `src/pages/ProjectLayout.tsx`.
- [ ] **Loading state**: When project snapshot is loading, show a loading state.  
  Observed in `src/pages/ProjectLayout.tsx` (`isLoading` branch).
- [ ] **Not found**: If project is missing, show “Project not found” and allow navigation back.  
  Observed in `src/pages/ProjectLayout.tsx`.
- [ ] **Offline vs error messaging**: When load fails due to offline, show “Offline” messaging; otherwise show an error state with retry.  
  Observed in `src/pages/ProjectLayout.tsx` (offline error detection) and `src/services/networkStatusService`.

## Refresh semantics
- [ ] **Refresh control**: Project shell provides a refresh affordance and disables it while in-flight.  
  Observed in `src/pages/ProjectLayout.tsx` (`isRefreshing`, refresh button).
- [ ] **Refresh behavior**: Refresh re-fetches collections (items, transactions, spaces) and optionally the project doc.  
  Observed in `src/contexts/ProjectRealtimeContext.tsx` (`refreshCollections(..., { includeProject: true })`).
- [ ] **Reconnect refresh**: After offline→online transition, active projects refresh to converge with server state.  
  Observed in `src/contexts/ProjectRealtimeContext.tsx` (network transition handler).
- [ ] **Post-sync refresh**: After outbox flush completes with zero pending ops, active projects refresh.  
  Observed in `src/contexts/ProjectRealtimeContext.tsx` (`onSyncEvent('complete', ...)`).

## Edit project
- [ ] **Entry point**: Edit is launched from Project shell into a modal form prefilled with the current project data.  
  Observed in `src/pages/ProjectLayout.tsx` (`isEditing`) and `src/components/ProjectForm.tsx`.
- [ ] **Edit submit**: Saving updates the project and refreshes the project snapshot.  
  Observed in `src/pages/ProjectLayout.tsx` (`handleEditProject`).
- [ ] **Offline update**: If offline, updates are queued for offline sync.  
  Observed in `projectService.updateProject` in `src/services/inventoryService.ts`.

## Delete project
- [ ] **Confirmation**: Delete requires explicit confirmation and warns about data loss.  
  Observed in `src/pages/ProjectLayout.tsx` (confirm dialog text).
- [ ] **Delete behavior**: Confirming delete removes the project and returns to the Projects list.  
  Observed in `src/pages/ProjectLayout.tsx` (`handleDeleteProject`) and `projectService.deleteProject` in `src/services/inventoryService.ts`.
- [ ] **Offline delete**: If offline, delete is queued for offline sync.  
  Observed in `projectService.deleteProject` in `src/services/inventoryService.ts`.

## Collaboration (Firebase target)
- [ ] **No large listeners**: The mobile app does not attach listeners to large collections (items/transactions) for realtime.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
- [ ] **Change-signal listener**: While a project is active + foregrounded, the mobile app listens only to `meta/sync` for that project.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
- [ ] **Delta sync on signal**: Signal change triggers delta fetches for advanced collections and local DB upserts/deletes.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.

