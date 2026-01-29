# BusinessInventoryHome (screen contract — business inventory)

## Intent
Provide the “business inventory” workspace shell with two tabs (Items + Transactions), a shared refresh control, and state/scroll restoration so users can move between long lists and detail screens without getting lost.

## Inputs
- Route params: none
- Persisted list state:
  - Web parity uses query params (see Parity evidence).
  - Mobile (Expo Router) must use a list state store keyed by stable keys:
    - `inventory:items`
    - `inventory:transactions`
- Entry points:
  - Global navigation → Business inventory workspace
  - Return from item/transaction create/edit/detail via native back stack (Expo Router) with list-state + scroll restoration handled by the shared list modules.

## Reads (local-first)
- Local DB queries:
  - Inventory-scoped Items list (items with no `projectId` in the web model; in Firebase, inventory scope is explicit).
  - Inventory-scoped Transactions list (transactions in inventory scope; `projectId` absent/null).
- Derived view models:
  - Filtered/sorted/grouped Items list
  - Filtered/sorted Transactions list
- Cached metadata dependencies:
  - Budget categories (for transactions category filter)
  - Vendor defaults and tax presets (used by transaction create/edit flows; loaded by downstream screens)

## Writes (local-first)
For each user action, list the conceptual mutation:
- Manual refresh:
  - Outbox: none (read-only)
  - Delta sync: trigger foreground delta refresh for inventory scope
- Tab switch and list controls:
  - Outbox: none
  - Persist list state with debounce (web: URL params; mobile: list state store)

## UI structure (high level)
- Header: title + manual refresh control
- Tabs:
  - Items tab (shared Items module configured for `scope: 'inventory'`)
  - Transactions tab (shared Transactions module configured for `scope: 'inventory'`)

## Shared Items/Transactions reuse (required)

This screen is a **workspace shell only**. It must not fork the Items/Transactions implementations.

- The home shell constructs a single **scope config object** for inventory scope (see `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` → “Scope config object (contract)”).
- It passes that `ScopeConfig` into the shared Items module and shared Transactions module.
- Routing, query-param persistence, and navigation stack state remain owned by this shell; shared modules consume `ScopeConfig` and render behavior accordingly.

## User actions → behavior (the contract)
- Switch tabs:
  - Updates active tab and preserves the other tab’s list controls in persisted state.
- Search/filter/sort within each tab:
  - Updates list contents immediately based on local data.
  - Persists state with a debounce (avoid thrashing updates on every keystroke).
- Navigate to item/transaction detail:
  - Uses native navigation so “Back” returns to the originating list.
  - The shared list module records a restore hint (anchor id + optional scroll offset) before navigating so the list can restore on return.
- Manual refresh:
  - Forces a refresh of inventory scope collections.
  - Shows a user-facing error and allows retry if refresh fails.

## States
- Loading:
  - Initial load shows a loading state while the local snapshot is hydrating / refreshing.
- Empty:
  - Items tab empty state if no inventory items exist.
  - Transactions tab empty state if no inventory transactions exist.
- Error:
  - Surface snapshot load failures and offer retry.
- Offline:
  - Lists still render from local DB.
  - Manual refresh should indicate it requires connectivity (but must not break the UI).
- Pending sync:
  - Pending markers belong to the shared module contracts, not this shell; this shell must not hide them.
- Permissions denied:
  - Add/edit flows are role gated (see create screens); list browsing remains readable unless server rules restrict.

## Collaboration / realtime expectations
- **Intentional delta for mobile**: do not subscribe to large collections.
- While foregrounded in Business inventory:
  - Listen only to `accounts/{accountId}/inventory/meta/sync`
  - On signal change, run delta fetches and apply to SQLite

## Performance notes
- Expect large inventories; lists must be virtualized and list filtering should be backed by indexes in SQLite.
- URL/state persistence should be debounced to avoid jank while typing.
  - Mobile: list-state-store writes should be debounced similarly.

## Parity evidence
- URL state persistence (debounced): Observed in `src/pages/BusinessInventory.tsx` (debounced `setSearchParams`, 500ms).
- Tab selection and defaults: Observed in `src/pages/BusinessInventory.tsx` (`bizTab` parsing; default tab).
- Scroll restoration (web): Observed in `src/pages/BusinessInventory.tsx` (passes `scrollY` during navigate) + list screens restore via `location.state.restoreScrollY` pattern (see `src/pages/InventoryList.tsx`, `src/pages/TransactionsList.tsx`).
- Manual refresh semantics: Observed in `src/pages/BusinessInventory.tsx` (`handleRefreshInventory`, `refreshCollections({ force: true })`).

