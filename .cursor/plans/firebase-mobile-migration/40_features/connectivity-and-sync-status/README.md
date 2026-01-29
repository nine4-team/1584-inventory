# Connectivity + sync status (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **global connectivity + sync UX**, grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Global connectivity banner:
  - offline (“Changes will sync when reconnected”)
  - slow connection indicator
- Global sync status banner:
  - pending outbox count
  - syncing / waiting / error states
  - retry affordance when in error
- Retry behavior:
  - “Retry sync” warms offline prerequisites when online
  - triggers a foreground sync attempt
- Background/automatic sync error surfacing:
  - toast notifications for background-triggered sync failures

## Non-scope (for this feature folder)
- Per-entity “pending” UI markers in lists/details/forms (owned by each feature).
- Conflict resolution UX (owned by conflicts / sync engine specs).
- React Native-specific library choices (e.g. which NetInfo/background-task package) beyond required capabilities.

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Component contracts**:
  - `ui/components/NetworkStatus.md`
  - `ui/components/SyncStatus.md`
  - `ui/components/RetrySyncButton.md`
  - `ui/components/BackgroundSyncErrorNotifier.md`

## Cross-cutting dependencies
- Sync architecture constraints (local-first, outbox, delta sync, change-signal): `40_features/sync_engine_spec.plan.md`
- Offline prerequisites hydration (metadata caches): used by “Retry sync” and some forms; see parity evidence in `src/hooks/useOfflinePrerequisites.ts`.

## Parity evidence (web sources)
- Connectivity banner UI: `src/components/NetworkStatus.tsx`
- Sync status banner UI: `src/components/SyncStatus.tsx`
- Retry sync button (hydrates prerequisites + triggers sync): `src/components/ui/RetrySyncButton.tsx`
- Background sync error toasts: `src/components/BackgroundSyncErrorNotifier.tsx`
- Network detection + “actual online” ping: `src/services/networkStatusService.ts`, `src/hooks/useNetworkState.ts`
- Foreground sync scheduler state + backoff: `src/services/syncScheduler.ts`
- Outbox queue state (pending count, last enqueue errors): `src/services/operationQueue.ts`
- Realtime telemetry (staleness/disconnect signals used for logging today): `src/contexts/ProjectRealtimeContext.tsx`

