# Navigation Normalization — Developer Guide

This document is a concise, actionable guide for a junior developer to finish normalizing navigation to the stack-based pattern (NavigationStack + ContextLink) and to eliminate render-time side-effects that cause back-button loops (e.g., Transaction ↔ Item toggles).

Goal
- Ensure in-app Back controls return users to the most intuitive previous screen (mimic native back) while preserving sensible URL fallbacks for deep links.
- Remove render-time mutations of the nav stack and make pushes happen at click-time or immediately before programmatic navigations.

Background (short)
- The app uses a small navigation stack mirrored to `sessionStorage` to preserve Back across reloads in the same tab.
- Two helpers are used:
  - `useNavigationContext()` — builds context-aware URLs (`buildContextUrl`) and computes back targets (`getBackDestination`).
  - `NavigationStack` provider (in `src/contexts/NavigationStackContext.tsx`) — exposes `push`, `pop`, `peek`, etc.
- Problem: some code still calls `navigationStack.push(...)` during render (or `buildContextUrl()` has side-effects). Render-time pushes produce duplicate/out-of-order stack entries that cause `pop()` to return the wrong entry and produce toggle loops.

Quick rules (follow these always)
1. Never mutate navigation stack during render. `buildContextUrl()` must be pure.
2. Use `ContextLink` (click-time push) for link-based navigations that should be recorded to the stack.
3. Use `useStackedNavigate()` for programmatic navigations — but make it defensive (don’t push when calling `navigate(-1)` or when using `replace`).
4. For Back/Cancel buttons in forms prefer calling `navigate(backDestination)` where `backDestination` comes from `useNavigationContext().getBackDestination(defaultPath)` or render `ContextBackLink` which `pop()`s the stack.

Step-by-step tasks (ordered, with code)

Phase 0 — Audit (5–15m)
- Search for remaining direct calls that mutate the stack at render-time:
  - `navigationStack.push(`
  - `to={buildContextUrl(` used directly in JSX (we want `ContextLink to={buildContextUrl(...)} or Link to={buildContextUrl(...)}` but ensure buildContextUrl is pure)
  - `navigate(-1)` usages

Example grep commands:

```bash
rg "navigationStack.push\(|buildContextUrl\(|navigate\(-1\)" src/ -n
```

Make a short list of files where these appear.

Phase 1 — Make `buildContextUrl` pure (20–40m)
- Edit `src/hooks/useNavigationContext.ts` so `buildContextUrl` only composes a URL and sets query params (`from`, `returnTo`) but DOES NOT call `navigationStack.push(...)` or otherwise mutate state.

Example implementation (pure):

```ts
// src/hooks/useNavigationContext.ts (inside buildContextUrl)
const url = new URL(targetPath, window.location.origin)
const currentParams = new URLSearchParams(location.search)
const from = currentParams.get('from')
if (from) url.searchParams.set('from', from)
// Set returnTo only if not present so we preserve explicit returnTo if caller provided
if (!currentParams.get('returnTo')) {
  url.searchParams.set('returnTo', location.pathname + location.search)
}
// add any additional params
if (additionalParams) Object.entries(additionalParams).forEach(([k, v]) => url.searchParams.set(k, v))
return url.pathname + url.search
```

- Commit this change. The `buildContextUrl` should not call `push()` anymore.

Phase 2 — Add `ContextLink` (10–20m)
- Create `src/components/ContextLink.tsx` (if not present). This wrapper calls `navigationStack.push(currentPath)` in its `onClick` handler and then delegates to `react-router` `Link`.

Example `ContextLink`:

```tsx
// src/components/ContextLink.tsx
import React from 'react'
import { Link, LinkProps, useLocation } from 'react-router-dom'
import { useNavigationStack } from '@/contexts/NavigationStackContext'

export default function ContextLink(props: LinkProps) {
  const { onClick, ...rest } = props as any
  const location = useLocation()
  const navigationStack = useNavigationStack()

  const handleClick = (e: React.MouseEvent) => {
    try { navigationStack.push(location.pathname + location.search) } catch { /* noop */ }
    if (typeof onClick === 'function') onClick(e)
  }

  return <Link {...(rest as LinkProps)} onClick={handleClick} />
}
```

- Commit this file.

Phase 3 — Migrate forward links to `ContextLink` (20–60m)
- Replace render-time `to={buildContextUrl(...)}` inside `<Link ...>` usage that should push to the stack with `<ContextLink to={buildContextUrl(...)}>`.
- Priority files to migrate:
  - `src/pages/TransactionDetail.tsx` — item cards/links
  - `src/pages/InventoryList.tsx` (or similar) — item links
  - `src/pages/BusinessInventoryItemDetail.tsx` — project/transaction links
  - `src/components/ui/ItemLineageBreadcrumb.tsx`

Example replacement:

```diff
- <Link to={buildContextUrl(`/project/${projectId}/item/${item.itemId}`)}>
+ <ContextLink to={buildContextUrl(`/project/${projectId}/item/${item.itemId}`)}>
```

- After migration, those links will push the previous path at click-time instead of render-time.

Phase 4 — Fix programmatic navigation patterns (forms & buttons) (15–40m)
- Use `useStackedNavigate()` for programmatic navigations. But update `useStackedNavigate` to be defensive: do NOT push the current location when `to` is a numeric delta (e.g. `-1`) or when `options?.replace === true`.

Example change:

```ts
// src/hooks/useStackedNavigate.ts
const stackedNavigate = useCallback((to: To, options?: NavigateOptions) => {
  try {
    // Only push when navigating to a path string, not when going back or replacing
    if (typeof to !== 'number' && !(options && (options as any).replace)) {
      navigationStack.push(location.pathname + location.search)
    }
  } catch { }
  navigate(to, options)
}, [navigate, navigationStack, location.pathname, location.search])
```

- Commit this change.

Phase 5 — Replace `navigate(-1)` back usages (15–30m)
- Audit files with `navigate(-1)` and change them to compute a `backDestination` using `useNavigationContext().getBackDestination(default)` or render `ContextBackLink`.
- Priority files:
  - `src/pages/EditTransaction.tsx` — change `onClick={() => navigate(-1)}` to `onClick={() => navigate(backDestination)}` or render `<ContextBackLink fallback={backDestination} />`.
  - `src/pages/EditBusinessInventoryTransaction.tsx` — same pattern.

Example `EditTransaction` update:

```tsx
const { getBackDestination } = useNavigationContext()
const backDestination = useMemo(() => getBackDestination(`/project/${projectId}?tab=transactions`), [getBackDestination, projectId])

// Use this in the Cancel handler
<button onClick={() => navigate(backDestination)}>Cancel</button>
// or use ContextBackLink
<ContextBackLink fallback={backDestination}>Back</ContextBackLink>
```

Phase 6 — `ContextBackLink` behavior (read-only check)
- `ContextBackLink` should `pop()` the navigation stack and navigate to the popped target, falling back to the `fallback` prop if nothing available. Confirm this implementation exists in `src/components/ContextBackLink.tsx` and is used on detail pages.

Phase 7 — Tests & manual verification (30–90m)
- Manual test scenarios (walk through each):
  - Transaction → Item → Back should return to Transaction exactly once and stop (no toggles).
  - Project → Transaction → Edit → Cancel should return to Transaction or Project depending on context.
  - Business Inventory → Item → Project link → Back should return to Item.
  - Direct URL access to Item/Transaction should fall back to sensible defaults.

- Add unit tests for `useNavigationContext` and `NavigationStack` push/pop/dedupe/hydration.
- Add an integration/E2E test (Cypress or Playwright) for Transaction → Item → Back.

Recommended jest test skeleton for `useNavigationContext`:

```ts
// src/hooks/__tests__/useNavigationContext.test.tsx
it('returns returnTo when present', () => {
  const { result } = renderHook(() => useNavigationContext(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={["/project/1/item/2?returnTo=/project/1/transaction/3"]}>{children}</MemoryRouter>
  })
  expect(result.current.getBackDestination('/default')).toBe('/project/1/transaction/3')
})
```

Phase 8 — Rollout
- Merge changes to `supabase` branch (or your feature branch), deploy to staging, run manual smoke tests above, then promote to production.

Troubleshooting (common mistakes to watch for)
- Accidentally leaving `navigationStack.push` in `buildContextUrl()` — this is the primary cause of loops. Double-check `buildContextUrl` is pure.
- Using `Link to={buildContextUrl(...)}` without migrating to `ContextLink` for links that should be recorded — `buildContextUrl` is pure; you must use `ContextLink` to push on click.
- Leaving `navigate(-1)` calls without fixing `useStackedNavigate` — if you keep `navigate(-1)` you must ensure `useStackedNavigate` does not push before going back.

Files to edit (task list for the jr dev)
- [ ] `src/hooks/useNavigationContext.ts` — make `buildContextUrl` pure (no push side-effects).
- [ ] `src/components/ContextLink.tsx` — create click-time push wrapper.
- [ ] `src/hooks/useStackedNavigate.ts` — make push conditional (skip for numeric `to` or `replace`).
- [ ] `src/components/ContextBackLink.tsx` — confirm `pop()` behavior and `fallback` usage.
- [ ] Migrate links in:
  - `src/pages/TransactionDetail.tsx`
  - `src/pages/InventoryList.tsx` (or app-specific list pages)
  - `src/pages/BusinessInventoryItemDetail.tsx`
  - `src/components/ui/ItemLineageBreadcrumb.tsx`
- [ ] Replace-programmatic `navigate(-1)` usages in edit/form pages with `getBackDestination` or `ContextBackLink`.
- [ ] Add unit and integration tests.

Acceptance checklist
- [ ] `buildContextUrl` contains no `navigationStack.push` calls
- [ ] All link navigations that should be recorded use `ContextLink`
- [ ] All form cancel/back handlers use `getBackDestination` or `ContextBackLink`
- [ ] `useStackedNavigate` does not push on numeric deltas
- [ ] No reproduced Transaction ↔ Item toggle loop in staging

If you want, I can implement the code edits now (small steps):
1. Make `buildContextUrl` pure and create `ContextLink` (I can do both in one PR).
2. Migrate `TransactionDetail` item links to `ContextLink` and update `EditTransaction` to use `getBackDestination`.

Which part would you like me to implement first? If you'd like the doc shortened or expanded with more step-by-step commands, tell me which sections to adjust.
