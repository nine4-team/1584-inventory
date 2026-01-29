# `SyncStatus` (global sync banner) — contract

## Purpose
Expose outbox + sync state globally so users understand when changes are pending, syncing, waiting, or errored.

## Inputs (state)
- Outbox pending count (local): `operationQueue.length`
- Foreground scheduler snapshot (local): `isRunning`, `nextRunAt`, `lastError`
- Background/automatic sync state (local): progress/complete/error events from the sync engine
- Connectivity: `isOnline`

Parity evidence:
- `src/components/SyncStatus.tsx`
- `src/services/operationQueue.ts`
- `src/services/syncScheduler.ts`
- `src/hooks/useNetworkState.ts`

## Render rules

### When to show
Show the banner if any are true:
- pending count > 0
- `isRunning === true`
- background/automatic sync attempt is active
- there is a non-null sync error

### Variant precedence
Pick exactly one:
1. **error**: any sync error present
2. **syncing**: foreground syncing or background syncing active
3. **waiting**: pending > 0 and `nextRunAt` is in the future
4. **queue**: pending > 0

### Copy rules
- **error**: `Sync error: <message>` + show `RetrySyncButton`
- **syncing**: `Syncing changes…`
- **queue/waiting**:
  - if offline: `Changes will sync when you're back online`
  - else: `N changes pending`

## Firebase/RN adaptation note
This banner must reflect **outbox + delta sync + change-signal health**, not Supabase realtime subscription state.

