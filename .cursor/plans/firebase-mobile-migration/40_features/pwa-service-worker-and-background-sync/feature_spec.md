# PWA service worker + background sync (Web parity) → Mobile background execution + sync scheduling

## Intent
Preserve the *outcome* of the web app’s “PWA + service worker + background sync” feature while migrating to **React Native + Firebase**:
- users can keep working offline (local-first)
- queued changes sync automatically when possible
- when sync can’t proceed, the app explains what needs attention
- **without** expensive background polling or large realtime listeners

This feature is primarily a **policy + scheduling** spec. The canonical correctness mechanism (SQLite + outbox + delta sync + change-signal) is owned by `40_features/sync_engine_spec.plan.md`.

## Scope

### In-scope (RN/Firebase)
- **Foreground sync scheduling**:
  - on app open/resume: flush outbox then delta-sync; then attach the small change-signal listener for active scope(s)
  - on connectivity restored: if there are pending outbox ops, trigger a foreground sync run (when app is active)
- **Background execution (opportunistic, cost-guarded)**:
  - if the OS grants background time, attempt a short “sync work unit” (flush pending outbox; optionally run a minimal delta pass)
  - background work must be safe to skip without breaking correctness (foreground catches up)
- **User-visible semantics (improved from web where appropriate)**:
  - “automatic sync” is the default
  - manual “sync now” control is **optional** and should appear only when it is actionable (typically: online + error/stalled)
  - errors should prefer actionable next steps over a generic retry (re-auth, permissions changed, conflict needs resolution, attachment upload failed, etc.)

### In-scope (web parity evidence only; not re-implemented 1:1)
Document the existing web behavior for reference:
- service worker caches assets for offline navigation (`workbox` precache + cache routes)
- background sync triggers processing of the operation queue by delegating to open clients
- background sync re-registration uses backoff/cooldowns and stops loops

## Non-goals (explicit)
- Guaranteeing background sync completion while the app remains backgrounded.
- Implementing a Service Worker or PWA installation flow on mobile.
- Adding background listeners to large collections (or any “polling loop”) to emulate realtime.
- Any design/pixel specs.

## Definitions: “guaranteed” vs “opportunistic”

### Guaranteed behaviors (must always hold)
- **Correctness**: UI reads local SQLite only; local changes are durable immediately.
- **Eventual convergence**: when the user opens/resumes the app while online, the app flushes outbox and runs delta sync until caught up (subject to auth/permissions).
- **Cost control**: the app does not keep Firestore listeners running in background; no listeners on large collections ever.

### Opportunistic behaviors (nice-to-have; safe to skip)
- **Background sync attempts**: if the OS grants background time and the device is online, attempt a bounded sync run.
- **Background delta catch-up**: optionally run a minimal delta pass if it is cheap and bounded (see cost guardrails).

When opportunistic behavior does not run (OS restrictions, low power, background refresh disabled), the app must remain correct; it simply syncs on next foreground.

## High-level design (mobile)

### 1) The “sync work unit” (the only thing allowed in background)
One background wake is allowed to attempt *at most one* bounded “sync work unit”:
- read local pending outbox count
- if 0: do nothing
- if >0: attempt outbox flush (bounded)
- optionally: run a minimal delta catch-up pass (bounded), then stop

This aligns with `sync_engine_spec.plan.md`’s “Outbox Processor (foreground; optional background best-effort)” model.

Dedicated flow doc (step-by-step, non-ambiguous stop conditions):
- `flows/sync_work_unit.md`

### 2) Scheduling triggers (mobile)
The app may schedule opportunistic sync work on:
- **app backgrounded** (if there are pending ops)
- **connectivity regained** (when app active)
- **periodic OS background refresh** (platform-controlled interval)

The app must also *always* run a catch-up pass on:
- **app resume/open** (guaranteed path)

### 3) Realtime propagation constraints (mobile)
While foregrounded, realtime-like propagation uses:
- exactly one listener per active scope on a small signal doc (`meta/sync`)
- delta fetch by `updatedAt` cursor into SQLite

Backgrounded state:
- no listeners (stop `meta/sync` listener)
- no polling for “realtime”

## Cost guardrails (“not expensive” requirements)
Background behavior must be explicitly bounded:

- **No background listeners**:
  - never attach Firestore listeners when backgrounded (including `meta/sync`)
- **No polling loops**:
  - do not “wake and check” on tight intervals; rely on OS scheduling + app lifecycle
- **Bounded work per wake**:
  - cap outbox flush to a bounded batch (implementation choice; must avoid long loops)
  - cap delta fetch pages/time (implementation choice; must avoid long loops)
- **Backoff for failures**:
  - if a background run fails due to network/auth/permission errors, back off and do not thrash
- **User setting respect**:
  - if background refresh is disabled (platform), do not attempt to bypass it; rely on foreground

Telemetry expectations (for cost regression detection):
- track counts of: background wakes, background sync attempts, outbox flush writes, delta reads, failures by reason.

## UX: make it better than “Retry Sync everywhere”

### Default posture
- When online and there are pending ops, the app attempts to sync automatically.
- If the app can’t sync, show an explanation and (when actionable) a single clear action.

### Manual control (optional)
If we include a manual control, it should follow this contract:
- Only visible when actionable:
  - online AND (sync error OR sync appears stalled)
- If offline:
  - do not show “retry”; show “Waiting for connection”
- The action should trigger a foreground “sync work unit” plus prerequisite hydration (as described in `connectivity-and-sync-status/feature_spec.md`).

This spec intentionally does **not** require “Retry Sync” as a persistent UI pattern.

## Implementation reuse (porting) notes

### Reusable logic to port (web → mobile)
- SW event / status semantics (source labels, progress/complete/error payload shape): `src/services/serviceWorker.ts`
- Backoff/cooldown/loop-stopper ideas for retries: `public/sw-custom.js` (behavioral reference)

### Platform wrappers required (mobile)
- Background task scheduling/execution:
  - iOS: background app refresh tasks (OS-controlled)
  - Android: scheduled background work (OS-controlled)
- Connectivity reachability: RN network reachability (see connectivity feature spec)
- Persistent local DB/outbox: SQLite tables + scheduler (owned by sync engine plan)

### Intentional deltas
- No service worker, no PWA install flow.
- Background execution is opportunistic and bounded; correctness is guaranteed by foreground catch-up.
- Realtime “channels stale” telemetry becomes “change-signal listener health + last delta run timestamps” (see `connectivity-and-sync-status/feature_spec.md` and `sync_engine_spec.plan.md`).

## Parity evidence (web app)
- Background Sync API registration + manual trigger: `src/services/serviceWorker.ts`
- SW background sync handler + backoff + loop-stopper + delegation to clients: `public/sw-custom.js`
- Sync status UI reflects worker + scheduler + outbox: `src/components/SyncStatus.tsx`

