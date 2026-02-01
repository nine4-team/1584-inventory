# `BackgroundSyncErrorNotifier` — contract

## Purpose
Surface background/automatic sync failures that would otherwise be silent, via toasts.

## Inputs (events)
- A global sync-event bus that emits `error` events with:
  - `source` (background/automatic vs foreground/manual)
  - `error` message

Parity evidence:
- `src/components/BackgroundSyncErrorNotifier.tsx`
- `src/services/serviceWorker.ts` (sync event bus in web)

## Behavior
- Only respond to **background/automatic** errors (ignore foreground/manual errors here).
- Deduplicate identical errors for ~5 seconds.
- Classify toast severity:
  - If message contains “offline”/“Network offline”: show warning
  - Otherwise: show error

## React Native note (intentional delta)
There is no Service Worker; “background” means best-effort background execution. The event source naming can change, but the UX requirements remain.

