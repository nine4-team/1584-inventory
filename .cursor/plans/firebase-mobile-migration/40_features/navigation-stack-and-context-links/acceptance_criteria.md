# Acceptance criteria: Navigation + list-state + scroll restoration (Expo Router)

## Back correctness (React Navigation first)

- [ ] **Native back is primary**: If there is navigation history, Back uses Expo Router / React Navigation back behavior (`router.back()`), not a parallel custom stack.
- [ ] **Fallback when no history**: If there is no back history (deep link / cold start), Back uses `backTarget` if present, otherwise navigates to a deterministic safe fallback (scope root).

## List state preservation (filters/sort/search/tab)

- [ ] **Stable keying**: Every long list screen has a stable `listStateKey` that includes scope (projectId vs inventory).
- [ ] **Persist-on-change**: Updating search/filter/sort/tab persists into the list state store with debounce (no jank).
- [ ] **Restore-on-return**: Navigating to detail and back preserves the prior list controls.

## Scroll restoration (best-effort; “scroll back to the thing I tapped”)

- [ ] **Anchor-first restore**: After returning to a list, the list attempts to scroll back to the last interacted entity (anchor id) when possible.
- [ ] **Offset fallback**: If anchor restore fails, the list may restore a prior scroll offset (best-effort).
- [ ] **Non-blocking**: Restoration attempts must not block rendering. If restore fails, the list still renders normally.
- [ ] **No restore loops**: A restore hint is cleared after first attempt (success or fail) so the list does not keep jumping on subsequent renders.

## Cross-context flows

- [ ] **Business inventory list → item detail → back**: Back returns to Business inventory with list controls preserved and list scroll restored best-effort.
- [ ] **Transaction detail → item detail → back**: Back returns to Transaction detail via native stack behavior.

## Offline behavior

- [ ] **Works offline**: All navigation + list restoration behaviors function fully offline.
- [ ] **Survives reload (best-effort)**: List state persists across app reloads best-effort; if persistence fails, lists still load with defaults (no crash).

