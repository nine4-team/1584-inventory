# Screen contract: ProjectsList

## Intent
Show the user’s projects for the active account, provide a reliable entry point to create a project, and navigate into a project shell. This screen should behave predictably offline and after app restart.

## Inputs
- **Route params**: none
- **Query params**: none
- **Entry points**:
  - `/` (app entry)
  - `/projects`

Parity evidence: `src/App.tsx`.

## Reads (local-first)
- **Primary dataset**: projects for `currentAccountId`.
  - Hydrate from local cache first to avoid empty flashes after restart.
  - Then reconcile from network when online.
- **Secondary dataset (preview only)**: transactions used to compute per-project budget progress preview.

Parity evidence:
- Projects hydration + cache use: `src/pages/Projects.tsx` (`hydrateProjectsListCache`, React Query read) + `src/utils/hydrationHelpers.ts`
- Transactions preview loading: `src/pages/Projects.tsx` (`transactionService.getTransactionsForProjects`)

## Writes (local-first)
### Create project
- **Local mutation(s)**:
  - Create a local project row immediately (or enter an optimistic/pending state) so the list updates without waiting for network.
- **Outbox op(s) enqueued**:
  - `CREATE_PROJECT` with idempotency key `opId` (see sync engine spec).
- **Change-signal update**:
  - On successful remote write, increment/update `meta/sync` once for `projects` collection.

Web parity note:
- Web supports offline-queued creation and returns an optimistic id (`projectService.createProject`).

Firebase migration note:
- Create must be server-enforced via callable `createProject` (entitlements + membership), per `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`.

## UI structure (high level)
- Header: title “Projects” + “New” button
- Content:
  - Loading state
  - Empty state with CTA
  - Grid of project cards:
    - optional main image
    - name + client name
    - budget progress preview
    - “Open Project” button
- Create modal: `ProjectForm`

Parity evidence: `src/pages/Projects.tsx`, `src/components/ProjectForm.tsx`.

## User actions → behavior (the contract)
- **Open screen**
  - If account context is still loading, show loading state.
  - If account context is ready but no `currentAccountId`, show “No Account Selected” with Settings CTA.
  - Otherwise, render hydrated projects (if any) immediately and reconcile in background.
- **Tap “New”**
  - Open create modal.
- **Submit create modal**
  - Validate required fields.
  - If offline prerequisites are not ready, block submit and show a clear reason.
  - If allowed:
    - Create local pending project state immediately.
    - If online, attempt server creation.
    - If offline: apply the chosen entitlements policy for offline creation (see below).
- **Tap “Open Project”**
  - Navigate into project shell (Items tab as default).

Parity evidence:
- Guards + loading/empty states: `src/pages/Projects.tsx`
- Default open destination: `src/utils/routes.ts` (`projectItems`)
- Prerequisite blocking text: `src/hooks/useOfflinePrerequisites.ts`

## States
- **Loading**: show spinner and “Loading projects...”.
  - Observed in `src/pages/Projects.tsx`.
- **Empty**: show “No projects yet” and CTA.
  - Observed in `src/pages/Projects.tsx`.
- **Error**: show non-blocking error (log + fallback to empty), and keep the UI usable.
  - Observed in `src/pages/Projects.tsx` (logs and clears state).
- **Offline**:
  - Show cached projects if present.
  - If cache is cold, show empty state but do not imply “no projects exist remotely”.
  - Provide a path to retry when online (implementation choice).
- **Pending sync**:
  - Projects created locally but not yet confirmed should render in the list and be visually marked as pending (badge/spinner).
  - Clearing pending occurs once the outbox confirms or the server state arrives via delta.
- **Permissions denied**:
  - If the user lacks membership/role for the account, show access denied messaging and safe navigation back.
  - (Server-enforced in Firebase; client UX optional.)
- **Quota / entitlements blocked**:
  - If create is blocked due to entitlements, show upgrade CTA and allow retry after entitlements refresh.
  - Source: `40_features/_cross_cutting/billing-and-entitlements/feature_spec.md`.

## Media
- Main project image:
  - Selection validates type + size.
  - Upload is resumable/retryable; while offline, keep a local preview placeholder until upload succeeds.

Parity evidence:
- Validation + preview: `src/components/ProjectForm.tsx`
- Web: post-create upload + patch: `src/components/ProjectForm.tsx`

## Collaboration / realtime expectations
- While foregrounded and online:
  - Project list freshness should converge within ~1–5 seconds typical after remote writes elsewhere.
  - Must not subscribe to large collections; use account/project change-signal + delta strategy.

Source: `40_features/sync_engine_spec.plan.md`.

## Performance notes
- Expect project counts to be low (<500 typical), but render should be stable and not reflow excessively.
- Budget progress preview should not require expensive per-card network calls; prefer a batched fetch or local-derived rollups.

## Parity evidence
- `src/pages/Projects.tsx` (list UI, empty/loading, create modal trigger, open navigation)
- `src/services/inventoryService.ts` (`projectService.subscribeToProjects`, `createProject`)
- `src/utils/hydrationHelpers.ts` (`hydrateProjectsListCache`)

