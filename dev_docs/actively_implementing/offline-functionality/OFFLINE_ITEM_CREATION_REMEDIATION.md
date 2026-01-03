# Offline Item Creation Remediation (Action Plan)

## Purpose
Drive the engineering work needed to ship a resilient offline item creation system—capturing scope, current health, required fixes, owners, and verification so the product stays usable when the network disappears.

## Success Criteria
- Add Item resolves (success toast or “Saved for sync”) within ~2 s regardless of connectivity.
- No Supabase REST/auth/realtime requests fire while `networkStatusService` reports offline.
- Operation queue + background sync health is observable (structured logs + UI surfacing) and cannot hang the form.

## Current Status — 2026‑01‑05 (Verified)
- ✅ Queue writes now use cached `{accountId, userId}` and enqueue while offline.
- ✅ `_enrichTransactionsWithProjectNames` now guards with `isNetworkOnline()` and uses cached projects when offline.
- ✅ Background sync skips re-registration when offline, uses exponential backoff, and surfaces errors via toast notifications.
- ✅ Workbox packages are installed and the module service worker now registers in both dev/prod via `virtual:pwa-register`.
- ✅ `ProjectRealtimeContext` guards initialization with `isNetworkOnline()` to prevent offline fetch retries.
- ✅ `unifiedItemsService.createItem` returns optimistic ID + typed errors; uses `isNetworkOnline()` instead of `navigator.onLine`.
- ✅ Add Item UX now shows immediate optimistic feedback with proper messaging (queued vs saved).
- ✅ Optimistic items are hydrated into React Query cache so lists update immediately.

## Workstreams & Tasks

### 1. Share Reliable Network Signal (P0)
| Task | Status | Owner | Notes |
| --- | --- | --- | --- |
| Export authoritative snapshot from `networkStatusService` to all services | Done | _unassigned_ | `isNetworkOnline()` exported and used across services (13 uses in `inventoryService.ts`, 6 in `operationQueue.ts`). Remaining `navigator.onLine` checks are acceptable (initialization, service worker context, tests). |
| Replace remaining `navigator.onLine` checks in `inventoryService`, hooks, queue utilities | Done | _unassigned_ | `unifiedItemsService.createItem` and `ProjectRealtimeContext` now use `isNetworkOnline()`. Remaining checks are in `networkStatusService` (initialization) and `sw-custom.js` (service worker context), which are acceptable. |
| Guard `_enrichTransactionsWithProjectNames` with `isNetworkOnline()` and cached projects | Done | _unassigned_ | Now guarded with `isNetworkOnline()` (line 706) and uses cached projects from `offlineStore` when offline (lines 717-729). |
| Wrap outbound Supabase calls in `withNetworkTimeout` and fall back to queue when exceeded | Partial | _unassigned_ | `withNetworkTimeout` implemented and used in critical paths (`createItem` lines 2657, 2684). Broader application across all Supabase calls is a P1 enhancement. 2 s. |

### 2. Queue & Offline Context (P0)
| Task | Status | Owner | Notes |
| --- | --- | --- | --- |
| Ensure `offlineContext` is hydrated before offline-first screens render | Done | _unassigned_ | Added explicit initialization in App.tsx before rendering. |
| Confirm `operationQueue.add` only calls `getCurrentUser` when online + missing context | Done | _unassigned_ | Rev 1 change; monitor logs. |
| Emit structured logs when cached context missing / queue falls back | Done | _unassigned_ | Added structured logging with context details for QA visibility. |
| Return optimistic ID + typed errors from `unifiedItemsService.createItem` to Add Item screen | Done | _unassigned_ | Optimistic ID generated upfront; typed errors (OfflineContextError, OfflineQueueUnavailableError) properly propagated. |

### 3. Service Worker & Background Sync (P0)
| Task | Status | Owner | Notes |
| --- | --- | --- | --- |
| Install `workbox-core`, `workbox-routing`, `workbox-strategies`, `workbox-precaching`, `workbox-expiration`, `workbox-background-sync`, `workbox-window` | Done | _unassigned_ | Installed via `package.json`; `sw-custom.js` now imports modules directly. |
| Register same module worker in dev/prod; fail loudly if registration fails | Done | _unassigned_ | `virtual:pwa-register` now runs in all environments; failures surface via console. |
| Remove hard dependency on `navigator.serviceWorker.ready`; add timeout + capability guard | Done | _unassigned_ | `operationQueue.add` now uses fire-and-forget `ensureBackgroundSyncRegistration()`; `registerBackgroundSync` has timeout (750ms default) and capability guards; `unregisterBackgroundSync` and `triggerManualSync` also use timeout. |
| Background sync: skip re-registration when offline, add exponential backoff, surface toast/banner on failure | Done | _unassigned_ | `sw-custom.js` now checks `navigator.onLine` before re-registering; exponential backoff (2s base, max 60s) with jitter; `BackgroundSyncErrorNotifier` component surfaces failures via toast notifications. |

### 4. Add Item UX Resilience (P1)
| Task | Status | Owner | Notes |
| --- | --- | --- | --- |
| Return optimistic result immediately to form (navigate or toast) | Done | _unassigned_ | Implemented in `AddItem.tsx`, `AddBusinessInventoryItem.tsx`, and `TransactionDetail.tsx`. Shows "Item queued for sync" (offline) or "Item saved successfully" (online). Uses offline item ID for correlation. |
| Hydrate optimistic items into React Query / offline cache so lists update pre-sync | Done | _unassigned_ | Implemented `hydrateOptimisticItem()` helper in `hydrationHelpers.ts`. Updates project items, business inventory, and transaction items caches immediately after creation. |
| Structured metrics: record `lastEnqueueAt`, `lastOfflineEnqueueAt`, `backgroundSyncAvailable` | Done | _unassigned_ | Metrics already tracked in `operationQueue.ts`. Renamed `backgroundSyncEnabled` → `backgroundSyncAvailable` to clarify it indicates sync service status (not a user setting). Available in `OperationQueueSnapshot` for diagnostics view. |

### 5. Verification & QA
| Activity | Type | Status | Notes |
| --- | --- | --- | --- |
| Unit: `unifiedItemsService.createItem` short-circuits offline | Automated | Not started | Mock `networkStatusService`. |
| Unit: `operationQueue.add` skips Supabase auth when context cached | Automated | Not started | Regression guard. |
| Manual: offline submit, airplane-mode mid-request, corrupted IndexedDB | Manual | Not started | Track results in QA sheet. |
| Dev telemetry: toast + console warning when service worker/background sync missing | Manual/Runtime | Not started | Ensures visibility without devtools spelunking. |

## Risks & Observations
1. ~~ProjectRealtimeContext still initializes projects while offline → infinite fetch retries + noisy logs.~~ ✅ **RESOLVED**: Now guards with `isNetworkOnline()` (line 479).
2. ~~Background sync loops can drain battery/CPU when offline unless re-registration is gated.~~ ✅ **RESOLVED**: Re-registration skips when offline and uses exponential backoff.
3. Queue/UX still depend on service-worker callbacks resolving; if the controller is absent mid-session we currently hang without surfacing a warning. ⚠️ **MITIGATED**: `registerBackgroundSync` has timeout (750ms) and capability guards; `ensureBackgroundSyncRegistration` is fire-and-forget.

## Next Steps (Week of 2026‑01‑05)
1. ~~Ship `_enrichTransactionsWithProjectNames` + ProjectRealtime guards so offline requests stop hitting Supabase.~~ ✅ **COMPLETE**
2. ~~Decouple queue from service worker readiness; add timeout/capability checks plus log/UX surfacing for missing SW.~~ ✅ **COMPLETE**
3. ~~Update Add Item UI to resolve immediately with optimistic ID + offline toast messaging (P1).~~ ✅ **COMPLETE**
4. Consider broader application of `withNetworkTimeout` to all Supabase calls (P1 enhancement).

## Observed Problem Record

### New issue (2026‑01‑06): Conflict flood after offline create
- QA recorded a persistent `Conflict in: (content)` banner after creating an item offline and reconnecting. After hitting **Resolve All**, the banner disappeared briefly but the conflict count jumped from 8 → 10 on the next sync tick.
- IndexedDB shows conflicts for freshly generated optimistic IDs (e.g. `I-1767139637043-sn7g`, `I-1767159744325-6ugx`) on the `space`/`name` fields, which implies we are redetecting drift on items that should have synced cleanly moments earlier.
- No console telemetry accompanied the detections, so it’s unclear whether the queue retried, the conflict detector re-ran proactively, or stale conflicts were rehydrated from storage.
- Dedicated troubleshooting + instrumentation plan captured in `OFFLINE_CONFLICT_TROUBLESHOOTING.md`. Need to verify whether the problem is legacy data, value normalization (`null` vs `''`), or conflict detection running before local caches finish updating.

### TL;DR
- Creating an item while the workstation is offline leaves the Add Item screen stuck in “Creating…” because the current orchestration performs online-only Supabase calls before it ever enqueues an offline operation.
- Blocking calls: (a) `getCurrentUser()` inside `operationQueue.add`, which always issues `GET /auth/v1/user`, and (b) the “online-first” branch in `unifiedItemsService.createItem`, which trusts `navigator.onLine` instead of the authoritative heartbeat signal.
- We must (1) give services the same network signal as the UI, (2) remove Supabase auth round-trips from the offline queue path, and (3) add timeouts/instrumentation so the form can immediately fall back and surface a useful status.

### Status Snapshots
- **2026‑01‑02:** `operationQueue.add` now reads cached `{accountId,userId}` and enqueues offline; however, the Add Item surface still shows “Creating…” forever because the queued operation never resolves the original promise.
- **2026‑01‑02 (continued):** Identified `registerBackgroundSync()` awaiting `navigator.serviceWorker.ready`; dev never registers the worker because `vite.config.ts` sets `registerType = null`, so `.ready` never resolves and the form hangs.
- **2026‑01‑03:** Dev PWA worker now runs as module (`devOptions.type = 'module'`), but our injected `sw-custom.js` still used `importScripts`, causing `Failed to execute 'importScripts' on 'WorkerGlobalScope'`. Need ESM conversion.
- **2026‑01‑04:** After converting to module syntax, registration fails with `Failed to resolve module specifier "workbox-core"` because Workbox packages aren’t installed locally.

### Symptom Table
| Phase | What we saw | Why it matters |
| --- | --- | --- |
| Submit while offline | `GET …/auth/v1/user net::ERR_INTERNET_DISCONNECTED` + `[AuthFetch ERROR]` | `operationQueue.add` invokes Supabase auth before queueing, so offline flow blocks on network. |
| Remain offline | Devtools flooded with Supabase realtime websocket failures | Noise obscures the actual item failure because queue never logs progress. |
| Re-enable Wi-Fi | `[AuthFetch] … status: 200`, `inventoryService.ts:1788 Subscribed…`, but spinner never clears | Original promise unresolved; nothing reports success/failure to UI even though queue contains work. |

### Code Hotspots
- `unifiedItemsService.createItem` branches on `isBrowserOnline()` (just `navigator.onLine`), ignoring `useNetworkState`’s heartbeat signal.
- `operationQueue.add` used to always await Supabase `getCurrentUser()` even when offline context had the data.

### Root Cause Statement
Offline item creation hangs because the supposed “offline” code path still performs online-only auth and insert calls before falling back to the queue. When connectivity drops, `unifiedItemsService.createItem` misclassifies the session, attempts Supabase inserts, then waits for `operationQueue.add`, which waits for `getCurrentUser()`. None of those calls resolve while offline, so `handleSubmit` never settles and the UI spins indefinitely. Once Wi‑Fi resumes, Supabase reconnects (hence realtime logs), but the queued operation was never created, so no optimistic item appears.

## History
- **2026‑01‑05 (evening):** ✅ **CRITICAL BUG FIXES**: Fixed infinite loop in `ProjectRealtimeContext` that caused 2,300+ errors when offline. Fixed background sync infinite re-registration loop. Improved UI messages in `SyncStatus` component. Enhanced offline error handling in `ProjectLayout`. See "Critical Bug Fixes (2026‑01‑05)" section below.
- **2026‑01‑05 (later):** ✅ **P1 UX ENHANCEMENTS COMPLETE**: Implemented optimistic item hydration into React Query cache. Updated all item creation forms (`AddItem.tsx`, `AddBusinessInventoryItem.tsx`, `TransactionDetail.tsx`) to show immediate feedback with proper messaging ("Item queued for sync" vs "Item saved successfully"). Renamed `backgroundSyncEnabled` → `backgroundSyncAvailable` for clarity. All P0 and P1 tasks complete.
- **2026‑01‑05:** ✅ **VERIFICATION COMPLETE**: All P0 tasks verified as complete. `_enrichTransactionsWithProjectNames` and `ProjectRealtimeContext` now properly guard offline operations. Background sync implements exponential backoff and offline checks. Network signal sharing complete across services. Remaining work is P1 UX enhancements.
- **2026‑01‑04:** Identified missing network guards in transaction enrichment + ProjectRealtime; observed infinite background sync re-registration; noted Workbox modules absent.
- **2026‑01‑03:** Dev worker failed due to `importScripts` in module worker; plan to convert `sw-custom.js` to ESM and reuse across environments.
- **2026‑01‑02:** Queue now uses cached `{accountId, userId}` but Add Item still hangs because `navigator.serviceWorker.ready` never resolves.
- **Pre‑2026:** Offline path misused `navigator.onLine`, queued operations waited on Supabase auth, and Add Item spinner remained indefinitely.

## Critical Bug Fixes (2026‑01‑05)

### Issue 1: ProjectRealtimeContext Infinite Loop (P0)

**Problem:** When offline, `ProjectRealtimeContext` entered an infinite loop causing 2,300+ errors and 120,000+ warnings in console. The `useEffect` watching `snapshots` kept retrying initialization because `initializeProject` set `initialized: false` when skipping offline initialization, triggering the effect again.

**Root Cause:** 
- `useEffect` at line 549-555 watches `snapshots` and calls `initializeProject` for entries with `refCount > 0 && !initialized`
- When offline, `initializeProject` sets `initialized: false` and returns early
- This updates `snapshots`, triggering the `useEffect` again → infinite loop

**Fix Applied:**
1. Added network check at start of `useEffect` to skip initialization attempts when offline (`ProjectRealtimeContext.tsx` line 551)
2. Improved offline error handling in `ProjectLayout.tsx`:
   - Detects "Network unavailable" errors
   - Shows user-friendly "Offline" message instead of generic error
   - Hides "Try Again" button when offline (it won't work anyway)
   - Message: "You're currently offline. The project will load automatically when you reconnect."

**Files Changed:**
- `src/contexts/ProjectRealtimeContext.tsx` (line 549-555)
- `src/pages/ProjectLayout.tsx` (lines 216-239)

**Verification:** Creating items offline and navigating to projects no longer floods console with errors.

---

### Issue 2: Background Sync Infinite Re-registration Loop (P0)

**Problem:** After coming back online, background sync entered an infinite loop re-registering itself thousands of times, flooding console logs. The service worker would:
1. Complete sync successfully
2. See `pendingOperations: 1` (stale count due to timing)
3. Re-register sync immediately
4. Trigger again → complete → still shows 1 → loop

**Root Cause:**
- `sw-custom.js` line 134-135 re-registered sync whenever `pendingOperations > 0`
- No cooldown period after successful syncs
- No detection of stuck loops (same count multiple times)
- Race condition: queue count might not update before next sync triggers

**Fix Applied:**
1. **Added cooldown period:** 10-second minimum wait after successful sync before re-registering (`SYNC_COOLDOWN_MS = 10000`)
2. **Loop detection:** Track consecutive syncs with same pending count, stop after 3 (`MAX_CONSECUTIVE_SAME_COUNT = 3`)
3. **Better state tracking:** 
   - Track `lastSuccessfulSyncAt` timestamp
   - Track `lastPendingCount` to detect if count actually changed
   - Reset counters on failures (might be different issue)
4. **Improved logging:** More descriptive console messages for debugging

**Files Changed:**
- `public/sw-custom.js`:
  - Added cooldown constants (lines 40-42)
  - Enhanced `reRegisterBackgroundSync()` with cooldown and loop detection (lines 63-101)
  - Updated sync completion handler to track success timestamp (line 128)
  - Reset counters on failures (lines 142, 151)

**Verification:** Background sync now waits 10 seconds between successful syncs and stops re-registering if stuck in a loop. Console logs reduced from thousands to normal levels.

---

### Issue 3: SyncStatus UI Message Improvements (P1)

**Problem:** Sync status banner showed technical details like "[Foreground] 1 change pending — retrying in 5s" which was confusing for users and not user-friendly.

**Root Cause:**
- Component showed sync source labels (`[Foreground]`, `[Background]`, etc.)
- Displayed countdown timers in main message
- Didn't differentiate between online/offline states clearly

**Fix Applied:**
1. **Removed sync source labels** from main message (removed `[Foreground]`, `[Background]` prefixes)
2. **Simplified offline messages:** Show "Changes will sync when you're back online" when offline
3. **Removed countdown timers** from main message (moved to tooltip/details if needed in future)
4. **Network-aware messaging:** Uses `useNetworkState()` hook to show appropriate message based on connectivity

**Files Changed:**
- `src/components/SyncStatus.tsx`:
  - Added `useNetworkState()` import and usage (line 8, 27)
  - Simplified `statusMessage` logic (lines 159-176)
  - Removed sync source label prefix (line 200)

**Message Examples:**
- Offline: "Changes will sync when you're back online"
- Online, syncing: "Syncing changes…"
- Online, pending: "1 change pending" (or "X changes pending")
- Error: "Sync error: [error message]"

**Verification:** UI now shows clean, user-friendly messages without technical jargon.

---

### Issue 4: False-positive conflicts after offline create (P0)

**Problem:** After creating items offline and syncing, the app flagged persistent `content` conflicts (fields `space`/`name`) for newly created optimistic IDs. Resolutions would briefly clear the banner but conflicts reappeared on the next sync tick.

**Root Cause:** The server rows contained empty strings (`''`) for optional text fields while the client hydration step converted falsy values to `undefined` when caching. The conflict detector uses strict equality checks, so `''` vs `undefined` produced a bogus `content` diff.

**Fix Applied:**
1. Preserve server-returned empty strings during hydration by switching mapping logic to nullish coalescing (use `??` instead of `||`) in `mapSupabaseItemToOfflineRecord`.
2. Ensure cached items get a consistent `last_synced_at` snapshot when stored to prevent re-detection timing races.
3. Added verification steps and guidance to rebuild/refresh IndexedDB so stale `undefined` values are replaced.

**Files Changed:**
- `src/services/inventoryService.ts` (updated `mapSupabaseItemToOfflineRecord` to preserve blanks and use consistent timestamps)

**Verification:** Manual test: created items offline, reconnected, ran background sync — the `Data Conflicts Detected` banner did not reappear. Troubleshooting doc moved to `dev_docs/done_implementing` for audit trail.

---

### Issue 5: Persistent "Offline save queued" message after sync completes (P1)

**Problem:** After creating an item offline and successfully syncing, the UI continued to display "Offline save queued at [time]" even though the operation queue was empty and all operations had been processed. This created confusion as users saw a stale message indicating pending work when everything had already synced.

**Root Cause:** 
- `lastOfflineEnqueueAt` timestamp was set when operations were queued offline (line 192 in `operationQueue.ts`)
- The timestamp was never cleared when the queue successfully processed to zero length
- `RetrySyncButton` component displayed the message whenever `lastOfflineEnqueueAt` existed, without checking if there were actually pending operations

**Fix Applied:**
1. **Clear timestamp on successful sync:** Clear `lastOfflineEnqueueAt` to `null` when `processQueue` successfully processes all operations and the queue becomes empty (line 432 in `operationQueue.ts`)
2. **Clear timestamp on queue clear:** Also clear `lastOfflineEnqueueAt` when `clearQueue` is called (line 892 in `operationQueue.ts`)
3. **Defensive UI check:** Updated `RetrySyncButton` to only show the "Offline save queued" message when both `lastOfflineEnqueueAt` exists AND `pendingCount > 0` (line 84 in `RetrySyncButton.tsx`)

**Files Changed:**
- `src/services/operationQueue.ts` (lines 432, 892)
- `src/components/ui/RetrySyncButton.tsx` (line 84)

**Verification:** Created item offline, reconnected, waited for background sync to complete. The "Offline save queued" message now disappears once the queue is empty, matching the actual sync state.

---

## Summary of All Fixes

| Issue | Severity | Status | Files Changed |
|-------|----------|--------|---------------|
| ProjectRealtimeContext infinite loop | P0 | ✅ Fixed | `ProjectRealtimeContext.tsx`, `ProjectLayout.tsx` |
| Background sync infinite re-registration | P0 | ✅ Fixed | `sw-custom.js` |
| SyncStatus UI message clarity | P1 | ✅ Fixed | `SyncStatus.tsx` |
| ProjectLayout offline error handling | P1 | ✅ Fixed | `ProjectLayout.tsx` |
| Persistent "Offline save queued" message after sync | P1 | ✅ Fixed | `operationQueue.ts`, `RetrySyncButton.tsx` |

**Impact:**
- Eliminated 2,300+ console errors when offline
- Reduced background sync console spam from thousands to normal levels
- Improved user experience with clearer, less technical messages
- Better offline state handling throughout the app
- Fixed stale UI messages that persisted after successful syncs
