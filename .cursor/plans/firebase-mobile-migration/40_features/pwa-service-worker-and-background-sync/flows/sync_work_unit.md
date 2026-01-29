# Flow: “Sync work unit” (bounded background sync attempt)

## Intent
Define exactly what happens during **one** background sync attempt so it is:
- safe (never required for correctness)
- predictable (no runaway loops)
- not expensive (bounded work; no polling; no background listeners)

This flow is referenced by `../feature_spec.md`.

## What it is (plain language)
A “sync work unit” is one short try to send any saved offline changes up to the server. It does a small amount of work and then stops, even if there is more work remaining.

## Preconditions
- The app may or may not be connected to the internet.
- The OS may end background time at any moment.
- The app must assume this run might be skipped entirely.

## Step-by-step behavior (one attempt)

### 1) Start
- If there are **no pending changes**, stop immediately (do nothing).
- If the device is **offline**, stop immediately (do nothing) and wait for the next opportunity.

### 2) Try to sync pending changes (bounded)
If there are pending changes and the device is online:
- Try to sync a **limited chunk** of pending changes.
- If it succeeds and there are still pending changes, **stop anyway** and wait for a later opportunity.

### 3) Optional catch-up (bounded)
Optionally (only if it remains cheap), do a small “catch-up” to pull in remote updates.
- This must be bounded the same way (small, limited, then stop).

### 4) Stop conditions (always stop)
The work unit must stop when any of these happen:
- It has done its **maximum allowed** amount of work for this attempt.
- It hits a **blocking problem** (needs sign-in again, permissions changed, conflict needs resolution, etc.).
- The OS ends background time.

## Error handling (no thrash)
If the attempt fails:
- Do not immediately keep trying in a tight loop.
- Wait longer before the next attempt (backoff).
- Prefer to surface an actionable “needs attention” state next time the user opens the app.

Parity evidence reference: the web service worker uses cooldown/backoff and stops loops (Observed in `public/sw-custom.js`), but the mobile mechanism is an intentional delta.

## Cost guardrails (must hold)
- No background listeners of any kind (including the small change-signal listener).
- No “check every N seconds/minutes” polling loop.
- One attempt = one bounded work unit (no chaining).

