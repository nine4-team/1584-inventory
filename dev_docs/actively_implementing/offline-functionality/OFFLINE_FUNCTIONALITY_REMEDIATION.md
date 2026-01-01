## Offline Functionality Remediation Plan

### Purpose
Document the gap-closing work required to make Phases 1–3 production-ready for users with unreliable or no connectivity. This supplements the existing implementation plan and should be executed before Phase 4 polish.

---

### High-Level Goals
1. **Offline reads actually work** – every UI surface must hydrate from IndexedDB first and fall back to network only when available.
2. **Queued writes reliably sync** – operations are persisted durably, include all required fields, and flush automatically or via manual retry.
3. **Conflicts surface and resolve** – the system detects real divergences, blocks unsafe writes, and gives users actionable resolution flows.
4. **Plan + infra alignment** – timelines account for real browser support, schema gaps, auth, and media handling.

---

### Implementation Status (Rolling)
| Workstream | Status | Evidence / Next Action |
| --- | --- | --- |
| Data access layer | 🟠 In progress | `offlineStore`, `offlineAwareQuery`, and queue plumbing ship; AddItem/TransactionDetail/BusinessInventory forms still hit Supabase directly and skip IndexedDB hydration paths. |
| Operation queue & sync | 🟠 In progress | Queue scaffolding exists but metadata defaults and SW ownership unfinished. |
| Conflict detection & UX | 🟢 Completed | Detector, modal, IndexedDB persistence, UX embedding, and resolver writeback implemented. |
| Service worker & network state | 🟢 Completed | Ping endpoint with build timestamp, Background Sync registered, queue processing via SW delegation, essential data cached, network state hook fixed. |
| Schema & auth dependencies | 🟢 Completed | Migration applied: version/updated_by columns added to projects, business_profiles, budget_categories; RLS policies updated; auth refresh and validation implemented in operationQueue. |
| Media & large payload strategy | 🟢 Completed | Offline media service integrated into UI via `offlineAwareImageService`, storage quota warnings (`StorageQuotaWarning` component), upload queue moved to IndexedDB, automatic cleanup on app start. |
| Testing & tooling | 🟢 Completed | Unit tests for `conflictDetector` and `conflictResolver`, comprehensive integration tests for offline/online transitions, manual QA matrix documented in `OFFLINE_QA_MATRIX.md`. |

> Update this table whenever implementation moves forward so remediation progress stays visible.

---

### Remaining Offline Gaps (Must-Fix)
1. **UI flows still bypass offline services**
   - `AddItem`, `TransactionDetail` inline item CRUD, and business inventory forms call `unifiedItemsService` directly, so airplane-mode saves fail immediately.
   - `unifiedItemsService.create/update/delete` must become thin orchestrators that detect connectivity, delegate to `offlineItemService`/`operationQueue`, and hydrate from `offlineStore` before touching Supabase.
2. **Optimistic hydration parity**
   - Project/transaction/item queries hydrate from IndexedDB, but detail pages still refetch on mount and briefly show empty states offline.
   - Need shared helpers that prime React Query caches from `offlineStore` synchronously so UI never flashes “No data” when reopening offline.
3. **Offline UX feedback + retries**
   - `RetrySyncButton` exists, yet most forms never show success banners when queued (they only render errors from Supabase).
   - Each offline-aware mutation should emit a toast/inline banner explaining “Saved offline · will sync automatically,” plus actionable retry links tied to queue IDs.
4. **Regression coverage**
   - No automated test currently toggles `navigator.onLine = false` during item creation to assert queue writes + conflict surfacing.
   - Add Vitest/Cypress coverage that runs through Add→sync→conflict scenarios and validates IndexedDB persistence survives reloads.

### Implementation Guardrails
1. **Reuse existing primitives** – extend `offlineItemService`, `operationQueue`, `offlineStore`, `useNetworkState`, `RetrySyncButton`, and `offlineAwareQuery` rather than introducing component-specific hacks. `unifiedItemsService` becomes the single orchestrator that decides between online/offline paths.
2. **Document flow per surface** – every PR should include (or link) a short diagram/description for the touched UI (`AddItem`, Transaction detail, business inventory) showing: `Form → unifiedItemsService → offlineItemService → operationQueue → service worker → Supabase`, plus the IndexedDB hydration path (`offlineStore → React Query cache`). Keep it in this doc or link to design notes.
3. **Shared hydration helpers** – never read IndexedDB directly inside components. Always hydrate via the shared `offlineAwareQuery` so cache priming, stale-state detection, and write-back logic stay uniform.
4. **Centralized UX messaging** – use a single helper/toast/banner copy (“Saved offline · will sync automatically”) and expose retry actions that call `RetrySyncButton`/queue APIs. Avoid one-off verbiage.
5. **QA + tests as acceptance** – updates must reference the relevant rows in `OFFLINE_QA_MATRIX.md` and add/extend tests (`offline-integration.test.ts` or Cypress) that force offline saves, verify queue entries, reload the app, and confirm sync/conflict flows. PR reviewers reject changes that skip this evidence.
6. **Cross-cutting review** – at least one reviewer familiar with the offline stack should sign off; use this doc as the checklist during review to keep behavior consistent across features.

---

### Workstreams & Tasks

#### 1. Data Access Layer
- [x] Introduce an `offlineAwareQuery` helper that wraps React Query + IndexedDB (read-through, write-back).
- [x] Refactor item/transaction services to fetch from `offlineStore` when offline and hydrate caches on successful network fetches.
- [x] Extend `offlineStore` API (getAll, getById, upsert, delete) and stop resetting `version`/`last_synced_at` blindly.
- [x] Add migrations/versioning to `offlineStore` so schema changes can roll out safely.
- [ ] Route item create/update/delete flows (`AddItem`, `TransactionDetail` inline forms, business inventory screens) through `offlineItemService`/`operationQueue` instead of `unifiedItemsService` direct Supabase calls.
- [ ] Add regression coverage that forces airplane mode while saving an item and verifies queue persistence + optimistic UI hydration.

#### 2. Operation Queue & Sync
- [x] Move queue persistence from `localStorage` to IndexedDB (new `operations` store) with per-account partitioning. (`offlineStore` now exposes a v4 schema + compound `accountId_timestamp` index; `operationQueue` always hydrates/persists per-account snapshots.)
- [x] Ensure queued operations include `account_id`, `updated_by`, and current version/timestamp metadata.
- [x] Persist account + user context locally (Auth + Account providers and IndexedDB) so operations always have real metadata; remove placeholder `'default-account'` usage. (`AccountContext` hydrates from `offlineContext`, and both Auth/Account providers write through to IndexedDB for offline restores.)
- [x] Implement foreground retry loop with exponential backoff; add Background Sync registration when supported, with graceful fallback. (New `syncScheduler` subscribes to queue changes, retries with capped exponential backoff, and registers Background Sync when pending work remains.)
- [x] Emit service worker `SYNC_COMPLETE` messages and wire `SyncStatus` to display accurate progress/errors. (`SyncStatus` now listens to SW events + queue snapshots, showing source-aware banners; service worker helpers propagate progress/complete/error payloads.)
- [x] Provide manual “Retry sync” triggers anywhere data can be edited offline (project, transaction, and business inventory forms now wired).

#### 3. Conflict Detection & UX
- [x] Align column names (`item_id`, snake_case fields) between Supabase payloads and local cache. (implemented: `alignServerItemToLocal` in `conflictDetector`)
- [x] Compare actual mutable fields (description, disposition, pricing, etc.) plus timestamps/versions; ignore read-only columns. (implemented: `MUTABLE_ITEM_FIELDS` / `READ_ONLY_ITEM_FIELDS` in `conflictDetector`)
- [x] Store conflict metadata in IndexedDB so UX persists after refresh. (implemented: `offlineStore.saveConflict` + `useConflictResolution` hydration)
- [x] Embed `useConflictResolution` + `ConflictModal` into relevant views (e.g., project items, transactions) and during queue processing failures. (implemented: `ConflictResolutionView` included in `InventoryList` and `TransactionDetail`; queue gating in `operationQueue`)
- [x] Update `conflictResolver` to write back using canonical column names and convert camelCase→snake_case before Supabase updates. (implemented: `convertToDatabaseFormat` + `applyResolution` in `conflictResolver`)

#### 4. Service Worker & Network State
- [x] Add `/ping` endpoint (Implemented: Vite plugin injects build timestamp into ping.json) (Cloud Function or simple edge handler) so `useNetworkState` can verify connectivity without spurious failures.
- [x] Register Background Sync (Implemented: Background Sync registered in service worker, delegates to foreground clients via message passing) (`sync-operations`) inside the service worker and ensure it calls `operationQueue.processQueue`.
- [x] Move operation queue ownership (Implemented: Service worker handles Background Sync events and delegates to clients; re-registers sync on failure/partial completion) into the service worker (triggered by Background Sync or manual messages) so queue processing can run while the app is closed.
- [x] Cache essential API responses (Implemented: Projects cached via `cacheProjectsOffline`; items and transactions already cached) (projects, items, transactions, settings) via IndexedDB hydration rather than Cache API only.
- [x] Fix `useNetworkState` state updates (Implemented: Uses refs to avoid stale closures, tracks `lastOnline` correctly, exposes `isRetrying` state) (avoid stale closures, track `lastOnline` correctly, expose “offline but retrying” states).

#### 5. Schema & Auth Dependencies
- [x] Add `version` (integer) and `updated_by` columns to `items`, `transactions`, and any other mutable tables; backfill with defaults. (Implemented: Added version/updated_by to projects, business_profiles, budget_categories; items and transactions already had them)
- [x] Update Supabase RLS policies to allow queued writes that specify account + matching `updated_by`. (Implemented: Updated RLS policies for items, transactions, projects, business_profiles, and budget_categories to allow writes when updated_by matches auth.uid())
- [x] Ensure auth/session refresh happens before processing queue; persist minimal auth metadata required for offline writes. (Implemented: operationQueue refreshes session before processing; AuthContext/AccountContext persist userId/accountId to offlineContext; added validation that current user matches operation's updatedBy)

#### 6. Media & Large Payload Strategy
- [x] Define how images/documents are handled offline (e.g., queue uploads with Blob storage in IndexedDB, or gate editing while offline). (Implemented: `offlineMediaService` queues uploads in IndexedDB, `offlineAwareImageService` wraps upload logic)
- [x] Enforce storage quotas and warn users as they approach IndexedDB limits; add cleanup logic for stale blobs. (Implemented: `StorageQuotaWarning` component, quota checks in `ImageUpload`, automatic cleanup on app start)

#### 7. Testing & Tooling
- [x] Create automated integration tests simulating offline/online transitions (Cypress + service worker mocks). (Implemented: Comprehensive Vitest integration tests in `offline-integration.test.ts`)
- [x] Add unit tests for `offlineStore`, `operationQueue`, and conflict logic. (Implemented: Unit tests for `conflictDetector` and `conflictResolver`, existing tests for `offlineStore` and `operationQueue`)
- [x] Document manual QA matrix: cold start offline, long-lived offline edits, conflict scenarios, auth expiration mid-sync. (Implemented: Comprehensive QA matrix in `OFFLINE_QA_MATRIX.md`)

---

### Deliverables
1. Updated services/hooks with offline-first behavior.
2. IndexedDB migration scripts + Supabase migrations (version columns, policies).
3. Service worker & Background Sync implementation with fallbacks.
4. Conflict resolution UX wired into user flows.
5. Testing suite covering offline scenarios.
6. Revised phase timeline + browser-support notes reflecting new scope.

---

### Dependencies & Risks
- Requires Supabase schema changes to support versioning and conflict resolution.
- Background Sync unavailable on iOS Safari → must rely on foreground/manual sync there.
- IndexedDB quota varies by device; large media queues may exceed limits without proactive cleanup.
- Auth tokens may expire while offline; need UX for re-auth before sync.

---

### Success Criteria
- Users can load existing projects/items completely offline after one successful sync.
- Creating/updating/deleting items offline queues reliably and flushes automatically when connectivity returns.
- Conflicts are detected deterministically and surfaced within one interaction loop.
- Zero data loss reported during simulated airplane-mode sessions longer than 24 hours.

