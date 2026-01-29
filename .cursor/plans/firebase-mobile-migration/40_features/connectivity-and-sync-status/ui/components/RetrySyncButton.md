# `RetrySyncButton` — contract

## Purpose
Provide a deterministic “manual recovery” action when sync is stuck/errored, and proactively warm prerequisites that unblock offline flows.

## Inputs (state)
- Connectivity: `isOnline`
- Outbox snapshot:
  - `pendingCount`
  - `lastOfflineEnqueueAt`
  - `lastEnqueueError`
  - background/automatic sync availability (platform-specific)
- Offline prerequisites:
  - `status: 'ready' | 'warming' | 'blocked'`
  - `hydrateNow()`

Parity evidence:
- `src/components/ui/RetrySyncButton.tsx`
- `src/services/operationQueue.ts`
- `src/hooks/useOfflinePrerequisites.ts`
- `src/services/syncScheduler.ts`

## Behavior (on press)
1. Guard against double-taps while processing.
2. If online and prerequisites are `blocked` or `warming`, call `hydrateNow()` (best-effort; do not fail the whole retry if hydration fails).
3. Request a foreground sync attempt.

## Render rules (hints)
- If `showPendingCount=true` and `pendingCount>0`, show “(N pending)”.
- If `lastOfflineEnqueueAt` is set and `pendingCount>0`, show “Offline save queued at <time>”.
- If a platform indicates background/automatic sync is unavailable, show a warning hint explaining that the user should keep the app open or retry manually.

## React Native note (intentional delta)
Do not reference Service Worker–specific recovery steps (“reload to activate service worker”).

