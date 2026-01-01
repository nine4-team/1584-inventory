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
| Data access layer | 🔴 Not started | UI still calls Supabase directly; no IndexedDB hydration. |
| Operation queue & sync | 🟠 In progress | Queue scaffolding exists but metadata defaults and SW ownership unfinished. |
| Conflict detection & UX | 🟠 In progress | Detector + modal built, not embedded in flows yet. |
| Service worker & network state | 🟠 In progress | Ping endpoint + hook exist; SW still stub for queue processing. |
| Schema & auth dependencies | 🔴 Not started | No migrations for `version`/`updated_by` or RLS updates. |
| Media & large payload strategy | 🔴 Not started | Offline media service exists but unused in UI. |
| Testing & tooling | 🔴 Not started | Only unit tests drafted; no integration coverage. |

> Update this table whenever implementation moves forward so remediation progress stays visible.

---

### Workstreams & Tasks

#### 1. Data Access Layer
- [x] Introduce an `offlineAwareQuery` helper that wraps React Query + IndexedDB (read-through, write-back).
- [x] Refactor item/transaction services to fetch from `offlineStore` when offline and hydrate caches on successful network fetches.
- [x] Extend `offlineStore` API (getAll, getById, upsert, delete) and stop resetting `version`/`last_synced_at` blindly.
- [x] Add migrations/versioning to `offlineStore` so schema changes can roll out safely.

#### 2. Operation Queue & Sync
- [x] Move queue persistence from `localStorage` to IndexedDB (new `operations` store) with per-account partitioning. (`offlineStore` now exposes a v4 schema + compound `accountId_timestamp` index; `operationQueue` always hydrates/persists per-account snapshots.)
- [x] Ensure queued operations include `account_id`, `updated_by`, and current version/timestamp metadata.
- [x] Persist account + user context locally (Auth + Account providers and IndexedDB) so operations always have real metadata; remove placeholder `'default-account'` usage. (`AccountContext` hydrates from `offlineContext`, and both Auth/Account providers write through to IndexedDB for offline restores.)
- [x] Implement foreground retry loop with exponential backoff; add Background Sync registration when supported, with graceful fallback. (New `syncScheduler` subscribes to queue changes, retries with capped exponential backoff, and registers Background Sync when pending work remains.)
- [x] Emit service worker `SYNC_COMPLETE` messages and wire `SyncStatus` to display accurate progress/errors. (`SyncStatus` now listens to SW events + queue snapshots, showing source-aware banners; service worker helpers propagate progress/complete/error payloads.)
- [x] Provide manual “Retry sync” triggers anywhere data can be edited offline (project, transaction, and business inventory forms now wired).

#### 3. Conflict Detection & UX
- [ ] Align column names (`item_id`, snake_case fields) between Supabase payloads and local cache.
- [ ] Compare actual mutable fields (description, disposition, pricing, etc.) plus timestamps/versions; ignore read-only columns.
- [ ] Store conflict metadata in IndexedDB so UX persists after refresh.
- [ ] Embed `useConflictResolution` + `ConflictModal` into relevant views (e.g., project items, transactions) and during queue processing failures.
- [ ] Update `conflictResolver` to write back using canonical column names and convert camelCase→snake_case before Supabase updates.

#### 4. Service Worker & Network State
- [ ] Add `/ping` endpoint (Cloud Function or simple edge handler) so `useNetworkState` can verify connectivity without spurious failures.
- [ ] Register Background Sync (`sync-operations`) inside the service worker and ensure it calls `operationQueue.processQueue`.
- [ ] Move operation queue ownership into the service worker (triggered by Background Sync or manual messages) so queue processing can run while the app is closed.
- [ ] Cache essential API responses (projects, items, transactions, settings) via IndexedDB hydration rather than Cache API only.
- [ ] Fix `useNetworkState` state updates (avoid stale closures, track `lastOnline` correctly, expose “offline but retrying” states).

#### 5. Schema & Auth Dependencies
- [ ] Add `version` (integer) and `updated_by` columns to `items`, `transactions`, and any other mutable tables; backfill with defaults.
- [ ] Update Supabase RLS policies to allow queued writes that specify account + matching `updated_by`.
- [ ] Ensure auth/session refresh happens before processing queue; persist minimal auth metadata required for offline writes.

#### 6. Media & Large Payload Strategy
- [ ] Define how images/documents are handled offline (e.g., queue uploads with Blob storage in IndexedDB, or gate editing while offline).
- [ ] Enforce storage quotas and warn users as they approach IndexedDB limits; add cleanup logic for stale blobs.

#### 7. Testing & Tooling
- [ ] Create automated integration tests simulating offline/online transitions (Cypress + service worker mocks).
- [ ] Add unit tests for `offlineStore`, `operationQueue`, and conflict logic.
- [ ] Document manual QA matrix: cold start offline, long-lived offline edits, conflict scenarios, auth expiration mid-sync.

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

