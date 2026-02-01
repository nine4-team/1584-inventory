# Projects — Feature spec (Firebase mobile migration)

## Intent
Provide a local-first Projects experience: users can browse projects, open a project shell, and manage project metadata with predictable offline behavior. While foregrounded and online, the app should feel “fresh” without subscribing to large collections (use change-signal + delta sync).

## Owned screens / routes

### Projects list
- **Route**: `/projects` (also `/` entrypoint)
- **Web parity source**: `src/pages/Projects.tsx`

### Project shell
- **Route**: `/project/:projectId/*`
- **Tabs**: `items`, `transactions`, `spaces`, `budget`
- **Web parity source**: `src/pages/ProjectLayout.tsx`, `src/utils/routes.ts`

## Primary flows

### 1) Browse projects
- Load projects for the current account.
- Show loading → grid list → empty state.
- Tap a project → navigate to project Items tab by default (web uses `Open Project` linking to `projectItems(project.id)`).

Parity evidence:
- `src/pages/Projects.tsx` (loading/empty/grid + “Open Project” button)
- `src/utils/routes.ts` (`projectItems`, `projectsRoot`)

### 2) Create project (with optional main image)
Inputs:
- Required: `name`, `clientName`
- Optional: `description`, `budgetCategories` (dynamic categories), `main image`, `settings`

Web behavior summary:
- Create is initiated from Projects list (modal form).
- Form submission is blocked unless offline prerequisites are warm (metadata caches).
- If online, create attempts a network insert; if offline or network fails, creation is queued for offline processing and returns an optimistic project id.
- If an image was selected, for new projects it uploads after create and then patches the project with `mainImageUrl`.

Parity evidence:
- Create entrypoint + modal: `src/pages/Projects.tsx`
- Form validation + post-create image upload: `src/components/ProjectForm.tsx`
- Offline prerequisites gate: `src/hooks/useOfflinePrerequisites.ts` and `src/components/ui/OfflinePrerequisiteBanner.tsx`
- Offline queue fallback + optimistic id: `projectService.createProject` in `src/services/inventoryService.ts`

Firebase migration behavior (required delta: entitlements gating):
- **Project creation MUST be server-enforced** via a callable Function `createProject(...)` (no direct client create), per `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`.
- Function responsibilities:
  - verify membership/role for `accountId`
  - read `entitlements/current` for `accountId`
  - enforce `projectCount < maxProjects` (either via query or server-maintained counter)
  - create project doc and update `meta/sync` once

Offline policy choice (explicit):
- **Chosen policy (intentional delta vs current web)**: *Option A* — **block over-limit creation while offline**.
  - Rationale: avoids confusing “draft projects that disappear” when entitlements deny on reconnect; matches the cross-cutting recommendation.
  - Note: this differs from current web behavior which supports offline-queued project creation.

### 3) Edit project
- Initiated from Project shell (Edit button opens ProjectForm prefilled).
- On submit: update project and refresh snapshot.
- Image behavior:
  - If editing and new image selected: upload first, then write `mainImageUrl`.

Parity evidence:
- Edit flow: `src/pages/ProjectLayout.tsx` (`isEditing`, `handleEditProject`)
- Update + offline fallback: `projectService.updateProject` in `src/services/inventoryService.ts`
- Image upload on edit: `src/components/ProjectForm.tsx`

### 4) Delete project
- Initiated from Project shell (Delete button shows confirmation dialog).
- On confirm: delete project and return to Projects list.
- If delete fails: show error toast and keep user on the screen.

Parity evidence:
- Confirmation dialog + delete flow: `src/pages/ProjectLayout.tsx` (`showDeleteConfirm`, `handleDeleteProject`)
- Delete + offline fallback: `projectService.deleteProject` in `src/services/inventoryService.ts`

### 5) Refresh project snapshot
- Project shell provides a refresh affordance.
- Refresh re-fetches at minimum: project + transactions + items + spaces (implementation can optimize via delta).
- If refresh fails: show user-facing error and allow retry.

Parity evidence:
- Refresh button + behavior: `src/pages/ProjectLayout.tsx` (`handleRefreshProject`, `refreshCollections({ includeProject: true })`)
- Snapshot lifecycle + reconnect refresh: `src/contexts/ProjectRealtimeContext.tsx`

## Offline-first behavior (mobile target)

### Local source of truth
- UI renders from local DB (SQLite on mobile; IndexedDB + React Query + offlineStore on web).
- Writes apply locally immediately; remote sync is via outbox.

Migration constraint:
- Must follow: `40_features/sync_engine_spec.plan.md` (local DB + outbox + delta sync + single change-signal listener per active project).

### Restart behavior
- On cold start:
  - Projects list should render from local cache if present (avoid empty flash).
  - Project shell should hydrate cached snapshot (project + items/transactions/spaces) if available.

Parity evidence (web hydration):
- `hydrateProjectsListCache`, `hydrateProjectCache` in `src/utils/hydrationHelpers.ts`
- Project offline hydrate path: `src/contexts/ProjectRealtimeContext.tsx` (`hydrateProjectFromIndexedDB` when offline)

### Reconnect behavior
- When returning online, active project shells should refresh collections and clear any “hydrated from cache” stale indicator.

Parity evidence:
- `src/contexts/ProjectRealtimeContext.tsx` (offline→online transition triggers refresh of active projects)
- Additional refresh after outbox flush: `onSyncEvent('complete', ...)` in `src/contexts/ProjectRealtimeContext.tsx`

## Collaboration / “realtime” expectations (mobile target)
- Do not subscribe to large collections (items/transactions) for freshness.
- While foregrounded on a project:
  - attach **one** listener to `accounts/{accountId}/projects/{projectId}/meta/sync`
  - on signal change, run delta fetches for collections whose seq advanced
  - apply patches locally

Canonical migration source:
- `40_features/sync_engine_spec.plan.md` (§4 change signal doc + delta sync loop)

Intentional delta vs current web:
- Web uses Supabase realtime subscriptions (e.g., per-project transactions/items channels).
- Mobile must use change-signal + delta to control cost.

## Permissions and gating

### Authentication + account context
- User must be authenticated and have an active `accountId` to list/open/manage projects.

Parity evidence:
- Projects list requires `currentAccountId` and shows a “No Account Selected” guard UI: `src/pages/Projects.tsx`
- Account derivation and offline fallback: `src/contexts/AccountContext.tsx`

### Role gating (coarse v1)
Terminology mapping:
- Web roles: `owner | admin | user` (`user` ≈ “member”).

Firebase migration requirement:
- Callable `createProject` must verify membership + role (see entitlements doc).

Policy note:
- The current web Projects screens do not enforce role gating client-side; treat mobile role gating as **server-enforced** first (Rules/Functions), with optional client UX gates as follow-up.

### Offline prerequisites (metadata caches)
- Project form submission is blocked unless required caches are warm:
  - budget categories
  - tax presets
  - vendor defaults

Parity evidence:
- `src/hooks/useOfflinePrerequisites.ts` and `useOfflinePrerequisiteGate` usage in `src/components/ProjectForm.tsx`

