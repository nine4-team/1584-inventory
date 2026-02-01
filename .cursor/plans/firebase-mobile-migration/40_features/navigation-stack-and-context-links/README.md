# Navigation + list-state + scroll restoration (Expo Router)

This folder defines the parity-grade spec for **reliable navigation and list restoration** in the new React Native + Firebase app.

Important: the new app will use **Expo Router** (React Navigation). Therefore:

- **Back behavior** is owned by React Navigation (no parallel custom nav stack required for correctness).
- **List state + scroll restoration** are owned by shared list modules (Items/Transactions), keyed by a stable `listStateKey`.

## Scope

- **Back behavior** rules:
  - use native back stack when available
  - use `backTarget` fallback only for deep links / cold starts with no back history
- **List state** rules:
  - preserve filters/sort/search/tab via `ListStateStore[listStateKey]` (debounced)
- **Scroll restoration** rules:
  - restore “scroll back to the tapped row” via anchor-id restore (preferred)
  - optional scroll-offset fallback
  - clear restore hint after first attempt (avoid jump loops)

## Non-scope (for this feature folder)

- Pixel-perfect UI design for headers/back buttons.
- React Native library choices (e.g., React Navigation configuration), beyond required capabilities.
- Data fetching / sync behavior (this feature is navigation-only and must work offline).

## Key docs

- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Component contracts**:
  - `ui/components/ContextLink.md`
  - `ui/components/ContextBackLink.md`
  - `ui/components/NavigationStackService.md`

## Cross-cutting dependencies

- Offline-first UI invariants: `40_features/sync_engine_spec.plan.md` (not for navigation mechanics, but for the “UI must render from local state” mindset).
- Shared Items/Transactions module configuration:
  - `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` → “Scope config object (contract)”

## Parity evidence (web sources)

- URL/list state persistence + scroll restoration patterns (web parity mechanism):
  - Items list: `src/pages/InventoryList.tsx` (`itemSearch/itemFilter/itemSort` + `restoreScrollY`)
  - Transactions list: `src/pages/TransactionsList.tsx` (`tx*` params + `restoreScrollY`)
  - Business inventory: `src/pages/BusinessInventory.tsx` (`biz*` params; passes `scrollY` on navigate)
- Web-only helpers (not the mobile mechanism, but useful parity evidence):
  - Custom stack + persistence: `src/contexts/NavigationStackContext.tsx` (`SESSION_KEY = 'navStack:v1'`)
  - Stacked navigate wrapper: `src/hooks/useStackedNavigate.ts`
  - Back destination resolver + `returnTo` helpers: `src/hooks/useNavigationContext.ts`, `src/utils/navigationReturnTo.ts`
  - Context link/back link: `src/components/ContextLink.tsx`, `src/components/ContextBackLink.tsx`
- Real-world usage patterns (lists → detail → back/restore):
  - Business inventory shell (URL state + stacked navigation): `src/pages/BusinessInventory.tsx`
  - Items list/detail: `src/pages/InventoryList.tsx`, `src/pages/ItemDetail.tsx`
  - Transactions list/detail: `src/pages/TransactionsList.tsx`, `src/pages/TransactionDetail.tsx`

