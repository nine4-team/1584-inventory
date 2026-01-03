# Offline Conflict Troubleshooting — 2026‑01‑06

## Summary
- After successfully creating items offline and coming back online, the UI surfaces a persistent “Data Conflicts Detected” banner.
- Using **Resolve All** temporarily hides the banner, but the total conflict count increases on the next sync cycle (8 → 10 in the latest run).
- Conflicts target the brand-new optimistic IDs that were generated for offline creations, which means we are flagging items that should have just synced cleanly.

## Reproduction (current best guess)
1. Go offline and create multiple items (Project `6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70`, Account `2d612868-852e-4a80-9d02-9d10383898d4`).
2. Reconnect and allow background sync to run.
3. Observe “Data Conflicts Detected” banner with `Conflict in: (content)` messaging.
4. Click **Resolve All** (defaults to `keep_server` strategy).
5. Banner clears momentarily, then reappears with a *higher* conflict count.

## Evidence snapshot
Pulled directly from IndexedDB’s `conflicts` store after the latest run:

```
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767139637043-sn7g:content:space
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767159744325-6ugx:content:space
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767159744325-gwc6:content:space
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767395610391-on3l:content:name
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767397769662-u4qc:content:name
```

Notes:
- All conflicts reference optimistic item IDs (`I-…`) rather than legacy UUIDs, so they are newly created records.
- The conflicting fields are strictly `space` and `name`, suggesting a normalization/mutation mismatch rather than broad record drift.
- No related console logs were captured, which means the conflict detector/queue path is not instrumented enough to trace the cycle.

## Working theories
1. **Value normalization drift** — Local cache may store `''` while Supabase stores `null` (or vice versa) for `space`/`name`, so the detector keeps flagging a diff even when data “matches.”
2. **Stale conflict hydration** — `offlineStore.getConflicts` might be repopulating legacy entries after we delete them, so **Resolve All** clears the banner then the same payloads rehydrate on the next detection loop.
3. **Detector running before cache update** — Queue may finish syncing, but conflict detection runs before `offlineStore.saveItems` commits the server payload, so the diff reappears.

## Instrumentation / next steps
1. **Log local vs server values** whenever `conflictDetector.compareItems` finds a difference (include field, IDs, stringified values).
2. **Emit conflict detector breadcrumbs** (timestamp, trigger source) so we can correlate detections with queue retries or manual scans.
3. **Tag resolutions** — Extend `conflictResolver.applyResolution` to log which strategy ran and confirm `offlineStore.deleteConflictsForItems` succeeded.
4. **Add cooling window** — Before re-running detection for a project, skip items whose `last_synced_at` is newer than e.g. 15 s so freshly synced items are not rechecked immediately.
5. **Verify data on server** — Inspect Supabase rows for the listed optimistic IDs to confirm actual stored values for `space`/`name`.

## Open questions
- Are we re-queuing CREATE operations after resolution, causing a fresh sync and new conflicts?
- Does Supabase apply defaults/triggers to `space` or `name` (e.g., trimming whitespace) that the local cache never receives?
- Is the detector being invoked by `operationQueue` retries even when the queue is empty?

## Temporary mitigations
- None yet besides manual conflict resolution. Users can unblock themselves, but the banner immediately returns, so we treat this as **P0 investigation** until we understand the loop.

# Offline Conflict Troubleshooting — 2026‑01‑06

## Summary
- After successfully creating items offline and coming back online, the UI surfaces a persistent “Data Conflicts Detected” banner.
- Using **Resolve All** temporarily hides the banner, but the total conflict count increases on the next sync cycle (8 → 10 in the latest run).
- Conflicts target the brand-new optimistic IDs that were generated for offline creations, which means we are flagging items that should have just synced cleanly.

## Reproduction (current best guess)
1. Go offline and create multiple items (Project `6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70`, Account `2d612868-852e-4a80-9d02-9d10383898d4`).
2. Reconnect and allow background sync to run.
3. Observe “Data Conflicts Detected” banner with `Conflict in: (content)` messaging.
4. Click **Resolve All** (defaults to `keep_server` strategy).
5. Banner clears momentarily, then reappears with a *higher* conflict count.

## Evidence snapshot
Pulled directly from IndexedDB’s `conflicts` store after the latest run:

```
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767139637043-sn7g:content:space
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767159744325-6ugx:content:space
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767159744325-gwc6:content:space
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767395610391-on3l:content:name
conflict:2d612868-852e-4a80-9d02-9d10383898d4:I-1767397769662-u4qc:content:name
```

Notes:
- All conflicts reference optimistic item IDs (`I-…`) rather than legacy UUIDs, so they are newly created records.
- The conflicting fields are strictly `space` and `name`, suggesting a normalization/mutation mismatch rather than broad record drift.
- No related console logs were captured, which means the conflict detector/queue path is not instrumented enough to trace the cycle.

## Working theories
1. **Value normalization drift** — Local cache may store `''` while Supabase stores `null` (or vice versa) for `space`/`name`, so the detector keeps flagging a diff even when data “matches.”
2. **Stale conflict hydration** — `offlineStore.getConflicts` might be repopulating legacy entries after we delete them, so **Resolve All** clears the banner then the same payloads rehydrate on the next detection loop.
3. **Detector running before cache update** — Queue may finish syncing, but conflict detection runs before `offlineStore.saveItems` commits the server payload, so the diff reappears.

## Instrumentation / next steps
1. **Log local vs server values** whenever `conflictDetector.compareItems` finds a difference (include field, IDs, stringified values).
2. **Emit conflict detector breadcrumbs** (timestamp, trigger source) so we can correlate detections with queue retries or manual scans.
3. **Tag resolutions** — Extend `conflictResolver.applyResolution` to log which strategy ran and confirm `offlineStore.deleteConflictsForItems` succeeded.
4. **Add cooling window** — Before re-running detection for a project, skip items whose `last_synced_at` is newer than e.g. 15 s so freshly synced items are not rechecked immediately.
5. **Verify data on server** — Inspect Supabase rows for the listed optimistic IDs to confirm actual stored values for `space`/`name`.

## Open questions
- Are we re-queuing CREATE operations after resolution, causing a fresh sync and new conflicts?
- Does Supabase apply defaults/triggers to `space` or `name` (e.g., trimming whitespace) that the local cache never receives?
- Is the detector being invoked by `operationQueue` retries even when the queue is empty?

## Temporary mitigations
- None yet besides manual conflict resolution. Users can unblock themselves, but the banner immediately returns, so we treat this as **P0 investigation** until we understand the loop.

