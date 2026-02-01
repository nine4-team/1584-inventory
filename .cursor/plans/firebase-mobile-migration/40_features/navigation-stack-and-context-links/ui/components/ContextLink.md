# Component contract: ContextLink

## Intent

Provide a link/navigation helper that:

1) Records list restoration hints (including “scroll back to tapped item”) when navigating out of a long list
2) Navigates to the target screen

## Required behaviors

- When used from a long list screen, ContextLink (or the shared list module navigation adapter) must:
  - write a restore hint into `ListStateStore[listStateKey].restore`:
    - preferred: `anchorId = <tapped entity id>`
    - optional: `scrollOffset = <current list offset>` (fallback)
  - navigate using Expo Router (React Navigation).
- Navigation must not depend on any parallel custom stack for correctness.

## Parity evidence (web)

- `src/components/ContextLink.tsx`
  - pushes `location.pathname + location.search`
  - includes `window.scrollY` when finite
  - (mobile adaptation) in web this information is used later to restore scroll; in mobile we store a restore hint keyed by `listStateKey`.

