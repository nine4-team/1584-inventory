# Feature spec: Navigation + list-state + scroll restoration (Expo Router)

## Summary

Users navigate from **long lists** (items, transactions, spaces) into **detail** screens, then go back. The app must:

- return to the correct list/screen
- preserve list controls (search/filter/sort/tab)
- restore scroll position (best-effort), ideally to the last interacted item

In the new app we will use **Expo Router** (React Navigation). Therefore:

- **Back behavior is owned by React Navigation** (no parallel custom “nav stack” as the primary system)
- **List state + scroll restoration are owned by our shared list modules** (Items/Transactions/Spaces), keyed by a stable `listStateKey`
- We keep a **small explicit fallback** (`backTarget`) for deep links / cold starts where there is no back stack

## Goals

- **Reliability**: minimal moving parts; no “two sources of truth” for navigation history.
- **Native correctness**: use React Navigation back stack whenever possible.
- **State preservation**: list controls persist across navigation without relying on URL search params.
- **Best-effort restoration**: scroll restore is non-blocking and safe.

## Key definitions

### Expo Router navigation stack (primary)

React Navigation’s stack history. This is the authoritative back stack.

### `backTarget` (fallback only)

A typed fallback destination used when the user entered a screen without navigation history (deep link, cold start, external link).

### `listStateKey` (required for all long lists)

A stable string key that identifies a list screen’s “state namespace”, including scope.

Examples (doc-only):

```ts
// project scope
listStateKey = `project:${projectId}:items`
listStateKey = `project:${projectId}:transactions`

// inventory scope
listStateKey = `inventory:items`
listStateKey = `inventory:transactions`
```

### ListStateStore (required)

A small local store that persists:

- list controls: search/filter/sort/tab/grouping
- scroll restoration hints:
  - preferred: `anchorId` (the item/transaction id the user navigated from)
  - optional: `scrollOffset` (secondary fallback)

This is **not** navigation history; it’s “list UI state”.

## Parity behaviors we must preserve (web → mobile)

### A) List controls persist across deep navigation

Web parity:
- List controls are persisted to URL search params with debounce, and restored on mount:
  - Items list: `src/pages/InventoryList.tsx` (`itemSearch/itemFilter/itemSort`, 500ms debounce)
  - Transactions list: `src/pages/TransactionsList.tsx` (`tx*` params, sync effects)
  - Business inventory: `src/pages/BusinessInventory.tsx` (`biz*` params, 500ms debounce)

Mobile requirement:
- Persist the same logical state in `ListStateStore` keyed by `listStateKey`.
- Debounce writes (avoid jank while typing).
- List state must survive navigating to detail and back.

### B) Scroll restoration on back (restore to where you were)

Web parity:
- Before navigating into a detail screen, the app captures `window.scrollY`.
- On return, the list reads `location.state.restoreScrollY`, calls `window.scrollTo`, then clears the flag via `navigate(..., { replace: true })`.
  - Items list restore: `src/pages/InventoryList.tsx` (effect uses `restoreScrollY`)
  - Transactions list restore: `src/pages/TransactionsList.tsx` (same pattern)
  - Back link pop passes `restoreScrollY`: `src/components/ContextBackLink.tsx`

Mobile requirement (Expo Router / RN):
- Primary: restore by **anchor id** (scroll to the last-clicked item/tx) when possible.
- Secondary: restore by **scroll offset** when available and safe.
- Restoration must be best-effort and non-blocking:
  - if the item no longer exists under current filters, do nothing (or scroll to top) and continue.

## Required behaviors (mobile implementation contract)

### 1) Back behavior

- If `router.canGoBack()` (or equivalent) is true: **use native back** (`router.back()`).
- If not: navigate to `backTarget` if present; otherwise go to a deterministic safe fallback (scope root).

No custom “navStack:v1” equivalent should be required for correctness.

### 2) Navigating from list → detail (what must be recorded)

When the user opens a detail screen from a list:

- Record `originAnchorId` (the entity id the user opened) into the list’s `ListStateStore[listStateKey].restore`.
- Optionally record `scrollOffset` as a secondary fallback.
- Navigate to detail with a minimal `NavContext` (params/state):
  - `listStateKey` (so the detail screen can participate in “return to list” fallbacks if needed)
  - optional `backTarget` (only if there is a realistic chance of “no back history”)

### 3) Returning to a list (restoration)

When a list screen becomes active again:

- If there is a pending restore hint in `ListStateStore[listStateKey].restore`:
  1) Attempt anchor restore first (find index of `anchorId` in the current filtered/sorted list; `scrollToIndex`).
  2) If that fails, attempt offset restore if present (`scrollToOffset`).
  3) Clear the restore hint after a successful attempt (or after first attempt to avoid loops).

### 4) Filters/sort preservation

- All list control changes must:
  - update the list immediately (SQLite query / derived filters)
  - persist into `ListStateStore[listStateKey]` with debounce

### 5) Cross-context flows (without special-case “from” strings)

We do not want stringly `from=...` branching as the primary mechanism in the new app.

Instead:
- Use native back stack when it exists.
- When it does not exist (cold start deep link), rely on `backTarget`.

Required examples:
- Business inventory → Item detail → back returns to Business inventory list state and scroll restores.
- Transaction detail → Item detail → back returns to Transaction detail (native stack).

## Guardrails (to prevent breakage as the app evolves)

- **Single source of truth for history**: React Navigation is the navigation history. We do not maintain a parallel global history stack as the default.
- **Separate concerns**:
  - navigation (back stack / backTarget)
  - list UI state (filters/sort/search/tab + restore hints)
- **Non-blocking restore**: never block rendering waiting for list restoration.
- **Bounded + resilient store**: `ListStateStore` must be size-bounded and tolerate malformed persisted data (ignore and continue).

