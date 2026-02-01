# Component contract: Navigation + ListStateStore (Expo Router)

## Intent

In the mobile app we use **Expo Router** (React Navigation). Therefore:

- **Navigation history is owned by React Navigation** (native back stack).
- We maintain a **separate list state store** to preserve filters/sort/search/tab and to support best-effort scroll restoration on return to lists.

This doc defines the minimal contracts needed by shared list modules (Items/Transactions/Spaces).

## Navigation contract (back behavior)

### `backTarget` (fallback only)

`backTarget` exists only to support deep links / cold starts where there is no navigation history.

Doc-only shape:

```ts
export type BackTarget =
  | { kind: 'scopeRoot'; scope: 'project'; projectId: string }
  | { kind: 'scopeRoot'; scope: 'inventory' }
  | { kind: 'route'; pathname: string; params?: Record<string, string> }
```

Required behavior:

- If `router.canGoBack()` is true: use `router.back()`.
- Else:
  - navigate to `backTarget` if provided
  - otherwise navigate to a deterministic safe fallback (scope root)

## ListStateStore contract (required)

### Data persisted per `listStateKey`

Doc-only shape:

```ts
export type ListRestoreHint = {
  anchorId?: string       // preferred: entity id user tapped
  scrollOffset?: number   // fallback: list offset
}

export type ListState = {
  // list controls
  searchQuery?: string
  filterMode?: string
  sortMode?: string
  activeTab?: string
  // restoration
  restore?: ListRestoreHint
  // internal
  updatedAtMs?: number
}
```

Required semantics:

- **Stable keying**: `listStateKey` must include scope (projectId vs inventory).
- **Debounced persistence**: list controls persist with debounce to avoid jank.
- **Anchor-first restore**:
  - on return to list, attempt to restore by `anchorId` (scroll to the tapped item)
  - fall back to `scrollOffset` if needed
  - clear the restore hint after first attempt (avoid loops)
- **Bounded + resilient**:
  - cap stored keys and expire old entries
  - tolerate malformed persisted data (ignore and continue)

## Parity evidence (web)

The web app uses URL params + a custom stack to achieve the same outcomes:

- List state persistence to URL: `src/pages/InventoryList.tsx`, `src/pages/TransactionsList.tsx`, `src/pages/BusinessInventory.tsx`
- Scroll restoration using `restoreScrollY`: `src/pages/InventoryList.tsx`, `src/pages/TransactionsList.tsx`
- Custom navigation stack (web-only mechanism): `src/contexts/NavigationStackContext.tsx`, `src/hooks/useStackedNavigate.ts`

