# Acceptance criteria — Mobile background execution + sync scheduling (parity-informed)

Each criterion must have **parity evidence** (Observed in …) or an **intentional delta**.

## A) Intentional deltas (must be explicit)
- [ ] **No Service Worker / PWA on mobile**: The RN app does not implement a service worker or PWA installation flow.  
  **Intentional delta** (platform constraint).
- [ ] **Background sync is not correctness-critical**: If the OS never grants background time, user data remains correct locally and sync completes on next foreground/resume.  
  **Intentional delta** (mobile OS scheduling constraints; correctness owned by outbox + delta).

## B) Guaranteed correctness behaviors (foreground path)
- [ ] **Local-first durability**: user edits are persisted locally immediately and survive app restart.  
  **Parity evidence** (concept): existing outbox/local store model; see `src/services/operationQueue.ts` (web) and canonical migration plan `40_features/sync_engine_spec.plan.md`.
- [ ] **Foreground catch-up**: on app open/resume while online, the app performs a sync catch-up pass (flush outbox, then delta sync) until “caught up” or a blocking error is reached.  
  **Intentional delta**: codifies the mobile guarantee; aligns with `40_features/sync_engine_spec.plan.md`.

## C) Opportunistic background behavior (bounded + safe to skip)
- [ ] **Bounded background work unit**: one background wake attempts at most one bounded “sync work unit”:
  - if no pending ops: no-op
  - if pending ops: attempt bounded outbox flush; optionally bounded delta pass  
  **Intentional delta** (mobile policy; cost guardrail).
- [ ] **No thrash**: repeated background failures apply backoff and do not create tight retry loops.  
  **Parity evidence**: web SW has cooldown/backoff/loop-stopper logic (Observed in `public/sw-custom.js`).  
  **Intentional delta**: the exact mobile mechanism differs but must preserve “no thrash”.

## D) Cost control (must not be expensive)
- [ ] **No background listeners**: when app is backgrounded, there are no Firestore listeners (including `meta/sync`).  
  **Intentional delta** (cost + platform policy; consistent with `40_features/sync_engine_spec.plan.md`).
- [ ] **No polling loop**: the app does not implement a “wake every N seconds/minutes and check” loop to emulate realtime.  
  **Intentional delta** (cost guardrail).
- [ ] **Realtime only via signal + delta (foreground)**: while foregrounded, collaboration propagation is implemented as one small `meta/sync` listener per active scope + delta queries; no listeners on large collections.  
  **Parity evidence** (migration requirement): `40_features/sync_engine_spec.plan.md`.

## E) User-visible UX expectations (make it better than “Retry” everywhere)
- [ ] **Automatic-first**: when online and there are pending changes, the app attempts to sync automatically (no manual action required in the common case).  
  **Parity evidence**: scheduler-driven behavior exists in web (Observed in `src/components/SyncStatus.tsx` + scheduler integration).
- [ ] **Actionable manual control is optional**: if a manual control exists, it is shown only when actionable (typically online + error/stalled), and it triggers a foreground sync work unit.  
  **Intentional delta**: we do not require a persistent “Retry Sync” UI.
- [ ] **Offline messaging**: when offline, the UI does not suggest actions that cannot succeed (no “retry” that just fails); it explains “waiting for connection.”  
  **Parity evidence**: web status message logic distinguishes offline (Observed in `src/components/SyncStatus.tsx`).

## F) Diagnostics/telemetry (for cost regressions)
- [ ] **Background sync metrics** exist (even if only in logs initially): background wakes, attempts, successes, failures by reason, and estimated Firestore reads/writes attributable to sync.  
  **Intentional delta**: required to detect accidental cost creep early.

