# Screen contract template (`ui/screens/<screen>.md`)

## Intent
What this screen is for (1–3 sentences).

## Inputs
- Route params:
- Query params:
- Entry points (where navigated from):

## Reads (local-first)
- Local DB queries:
- Derived view models:
- Cached metadata dependencies (categories/vendors/tax presets/templates/etc):

## Writes (local-first)
For each user action, list:
- Local DB mutation(s)
- Outbox op(s) enqueued (shape, idempotency key)
- Any change-signal updates triggered (conceptually)

## UI structure (high level)
Sections/components and what each does.

## User actions → behavior (the contract)
Bullet list of every important action and the resulting behavior/state changes.

## States
- Loading:
- Empty:
- Error:
- Offline:
- Pending sync (local writes queued):
- Permissions denied:
- Quota/media blocked:

## Media (if applicable)
- Add/capture/select:
- Placeholder rendering (offline):
- Upload progress UX:
- Delete semantics:
- Cleanup/orphan rules:

## Collaboration / realtime expectations
- Should this reflect remote changes while foregrounded? What is the expected latency?
- What is OK to be stale until next delta run?

## Performance notes
- Expected dataset sizes
- Required indexes/search behavior
- Virtualization/debouncing needs

## Implementation reuse (porting) notes
- Reusable logic to port (file paths + symbols):
- Platform wrappers required (navigation, storage, media, share/print, background execution):
- Any intentional deltas (why porting isn’t possible 1:1):

## Parity evidence
List “Observed in …” bullets with file + component/function name for non-obvious behaviors.

