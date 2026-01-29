## Goal
Produce parity-grade specs for `connectivity-and-sync-status`.

## Inputs to review (source of truth)
- Feature map entry: `40_features/feature_list.md` → **Feature 2: App shell: connectivity + sync status + retry UX**
- Sync engine spec: `40_features/sync_engine_spec.plan.md`
- Existing web parity sources:
  - `src/components/NetworkStatus.tsx`
  - `src/components/SyncStatus.tsx`
  - `src/components/ui/RetrySyncButton.tsx`
  - `src/components/BackgroundSyncErrorNotifier.tsx`
  - `src/services/networkStatusService.ts`, `src/services/syncScheduler.ts`, `src/services/operationQueue.ts`

## Owned screens (list)
This feature is **global UI** (no routed screens).
- `NetworkStatus` — contract required? **yes** — offline/slow UX is user trust critical.
- `SyncStatus` — contract required? **yes** — status precedence + copy + retry semantics.
- `RetrySyncButton` — contract required? **yes** — triggers prerequisite hydration + foreground sync.
- `BackgroundSyncErrorNotifier` — contract required? **yes** — failure surfacing and debouncing.

## Cross-cutting dependencies (link)
- Sync architecture constraints: `40_features/sync_engine_spec.plan.md`
- Offline prerequisites hydration (used by Retry): parity evidence in `src/hooks/useOfflinePrerequisites.ts`

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Component contracts (required):
- `ui/components/NetworkStatus.md`
- `ui/components/SyncStatus.md`
- `ui/components/RetrySyncButton.md`
- `ui/components/BackgroundSyncErrorNotifier.md`

## Prompt packs (copy/paste)
Recommended slices:
- Slice A: connectivity detection + banner copy/state model (NetworkStatus)
- Slice B: sync status state machine + precedence + copy (SyncStatus)
- Slice C: retry semantics + prerequisite hydration + error surfacing (RetrySyncButton + notifier)

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (offline/slow/queued/error/retry).
- Cross-links are complete (this feature ↔ sync engine spec).

