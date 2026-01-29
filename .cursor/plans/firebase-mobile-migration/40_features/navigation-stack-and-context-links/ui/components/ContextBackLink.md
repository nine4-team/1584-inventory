# Component contract: ContextBackLink

## Intent

Provide a back-navigation helper that:

1) Uses native back stack semantics when possible (Expo Router / React Navigation)
2) Falls back safely when there is no back history (deep links/cold start)

## Inputs

- `fallback`: a deterministic safe fallback route identity (string or route key)
- Optional: `backTarget` (fallback-only, for deep links/cold start)
- Optional: `title`, `children`, styling props (non-functional)

## Required behaviors

- On activation:
  - If the router can go back, call `router.back()`.
  - Otherwise navigate to `backTarget` if present; else navigate to `fallback`.

Notes:
- Scroll restoration is handled by list screens using `ListStateStore[listStateKey]` (not by passing `restoreScrollY` through the navigation action).

## Parity evidence (web)

- `src/components/ContextBackLink.tsx`
  - pops with `location.pathname + location.search`
  - navigates to `entry.path || fallback`
  - passes `state.restoreScrollY` when `entry.scrollY` is finite
  - (mobile adaptation) in Expo Router we prefer native back, and list restoration is performed by the list screen itself.

