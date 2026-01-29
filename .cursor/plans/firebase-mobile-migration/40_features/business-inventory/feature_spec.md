# Business inventory — Feature spec (Firebase mobile migration)

## Intent
Provide a local-first **Business inventory** workspace where users can manage inventory-scoped Items and Transactions, including bulk actions and project allocation, with predictable offline behavior. While foregrounded and online, the app should feel “fresh” without subscribing to large collections (use change-signal + delta sync).

Critical migration constraint:
- Follow `40_features/sync_engine_spec.plan.md` (local DB + outbox + delta sync + one change-signal listener per active scope; no large listeners).

Shared-module constraint:
- Inventory items and inventory transactions must reuse the shared Items/Transactions modules:
  - `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Owned screens / routes (conceptual)

### Business inventory home (tabs)
- **Route concept**: `/business-inventory`
- **Tabs**: `inventory` (Items) and `transactions`
- **Web parity source**: `src/pages/BusinessInventory.tsx`

### Inventory item detail
- **Route concept**: `/business-inventory/:itemId`
- **Web parity source**: `src/pages/BusinessInventoryItemDetail.tsx`

### Inventory item create/edit
- **Route concept**: `/business-inventory/add`, `/business-inventory/:itemId/edit`
- **Web parity source**: `src/pages/AddBusinessInventoryItem.tsx`, `src/pages/EditBusinessInventoryItem.tsx`

### Inventory transaction create/edit + detail
- **Route concept**:
  - `/business-inventory/transaction/add`
  - `/business-inventory/transaction/:transactionId/edit`
  - `/business-inventory/transaction/:transactionId` (detail)
- **Web parity source**:
  - Create/edit: `src/pages/AddBusinessInventoryTransaction.tsx`, `src/pages/EditBusinessInventoryTransaction.tsx`
  - Detail: `src/pages/TransactionDetail.tsx` (shared detail)

## Primary flows

### 1) Browse inventory items (list)
Behavior summary (web):
- Two-tab shell; Items tab is the default (`bizTab` URL param defaults to `inventory`).
- Items tab supports:
  - Search (`bizItemSearch`) across several item fields.
  - Filter modes (`bizItemFilter`): `all`, `bookmarked`, `no-sku`, `no-description`, `no-project-price`, `no-image`, `no-transaction`.
  - Sort modes (`bizItemSort`): `alphabetical`, `creationDate` (newest-first).
  - Bulk selection and bulk actions (allocate to project, generate QR codes when enabled, delete).
  - Duplicate grouping in the list (collapsed groups) with per-group selection helpers.
- List UI state is persisted/restored via URL params with a debounce.
- Navigation into detail preserves list state and supports stacked navigation with scroll restore.

Parity evidence:
- Tab + URL state persistence: `src/pages/BusinessInventory.tsx` (`bizTab`, `bizItemSearch`, `bizItemFilter`, `bizItemSort` and the debounced `setSearchParams` updater).
- Filter/sort enum sets: `src/pages/BusinessInventory.tsx` (`BUSINESS_ITEM_FILTER_MODES`, `BUSINESS_ITEM_SORT_MODES`).
- Bulk selection + actions: `src/pages/BusinessInventory.tsx` (selectedItems set; allocation modal; QR generation; delete).
- Scroll restoration (web): `src/pages/BusinessInventory.tsx` (passes `scrollY` during navigate) + list screens restore via the `restoreScrollY` pattern (see `src/pages/InventoryList.tsx`, `src/pages/TransactionsList.tsx`).

Firebase mobile target (shared-module mapping):
- Implement the Items tab using the shared Items module configured with `scope: 'inventory'` (no `projectId`), plus inventory-only actions (allocation).
- Do not fork a separate “business inventory items” component tree; implement via scope-config as required by:
  - `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

Mobile requirement (Expo Router; list restoration):
- Do not implement “filters/sort persistence + scroll restoration” separately in:
  - project items vs inventory items
  - project transactions vs inventory transactions
- Implement once per shared list module, keyed by:
  - `listStateKey = inventory:items` and `inventory:transactions` for Business Inventory.
- Restore behavior: anchor-id restore preferred (scroll back to the tapped row), optional scroll-offset fallback.

### 2) Inventory item create/edit (including images + quantity)
Behavior summary (web create):
- Create screen is accessible from business inventory and returns to `/business-inventory` (or `returnTo` when present).
- Validation: user must provide **either** a description **or** at least one image.
- Quantity pill allows creating N items in a loop.
- Images are selected from gallery/camera; preview supports remove and a max image count (5 in UI).
- On save:
  - `projectPrice` defaults to `purchasePrice` if left blank (at save time; no auto-fill while typing).
  - Each created item gets a generated `qrKey`.
  - If offline queue is used, show “saved offline” feedback and keep user moving.
- Optional association to a transaction at create time:
  - User can choose a transaction to associate; when selected, `source` is pre-filled from that transaction and some fields are hidden.

Parity evidence:
- Permission gate + access denied UI: `src/pages/AddBusinessInventoryItem.tsx` (`hasRole(UserRole.USER)` guard).
- Validation rule (description or image): `src/pages/AddBusinessInventoryItem.tsx` (`validateForm`).
- Quantity create loop + optimistic hydration: `src/pages/AddBusinessInventoryItem.tsx` (loop, `hydrateOptimisticItem`).
- Save-time `projectPrice` defaulting: `src/pages/AddBusinessInventoryItem.tsx` (sets `projectPrice: formData.projectPrice || formData.purchasePrice`).
- Offline queue failure messaging: `src/pages/AddBusinessInventoryItem.tsx` (`OfflineQueueUnavailableError`, `OfflineContextError`).

Firebase mobile target notes:
- Images must follow the offline media lifecycle (placeholders + uploads + cleanup) described in:
  - `40_features/_cross_cutting/offline_media_lifecycle.md`

### 3) Inventory item detail (allocate / assign to transaction / images / nav)
Behavior summary (web):
- Detail renders an item from the business-inventory snapshot (by `itemId`).
- The screen preserves the list’s search/filter/sort params for next/previous navigation and uses `replace: true` for next/prev so “Back” returns to the list, not through a chain of items.
- Actions include:
  - Bookmark toggle.
  - Edit / duplicate (duplicates are forced to remain disposition `inventory`).
  - Add to / change transaction, and remove from transaction (with confirmation).
  - Move to project (allocation modal).
  - Change disposition/status.
  - Delete item (confirm).
- Images:
  - Add images via gallery.
  - Image preview supports set-primary and remove.

Parity evidence:
- List param parsing + next/prev behavior: `src/pages/BusinessInventoryItemDetail.tsx` (reads `bizItemFilter/bizItemSort/bizItemSearch`, preserves them when navigating next/prev; uses `{ replace: true }`).
- Bookmark + actions menu wiring: `src/pages/BusinessInventoryItemDetail.tsx` (`toggleBookmark`, `ItemActionsMenu` props for allocation/transaction/delete/status).
- Allocation modal and offline feedback: `src/pages/BusinessInventoryItemDetail.tsx` (`allocateItemToProject`, `showOfflineSaved` when offline).
- Transaction assignment dialog: `src/pages/BusinessInventoryItemDetail.tsx` (`showTransactionDialog`, `handleChangeTransaction`, remove confirm).
- Images add/remove/set primary: `src/pages/BusinessInventoryItemDetail.tsx` (gallery selection, `ImagePreview`, remove/set primary handlers).

Firebase mobile target notes:
- Allocation correctness and idempotency must follow `40_features/inventory-operations-and-lineage/README.md` (server-owned invariants; multi-entity operation modeling).

### 4) Browse inventory transactions (list)
Behavior summary (web):
- Transactions tab supports:
  - Search (`bizTxSearch`)
  - Filter menu views (state persisted in URL):
    - status (`bizTxFilter`: `all`, `pending`, `completed`, `canceled`, `inventory-only`)
    - reimbursement (`bizTxReimbursement`: `all`, `we-owe`, `client-owes`)
    - receipt emailed (`bizTxReceipt`: `all`, `yes`, `no`) and a legacy `no-email` alias is accepted
    - type (`bizTxType`: `all`, `purchase`, `return`)
    - budget category (`bizTxCategory`)
    - completeness (`bizTxCompleteness`: `all`, `needs-review`, `complete`)
    - source (`bizTxSource`)
  - Sort menu (`bizTxSort`: `date-desc`, `date-asc`, `created-desc`, `created-asc`)
- Navigating to a transaction detail preserves scroll restoration semantics via stacked navigation.

Parity evidence:
- Transaction filter/sort enums + URL wiring: `src/pages/BusinessInventory.tsx` (`BUSINESS_TX_*` consts; `parseBusinessTx...` helpers; URL sync).
- Receipt filter legacy mapping: `src/pages/BusinessInventory.tsx` (`parseBusinessTxReceiptFilterMode` maps `no-email` → `no`).
- Scroll restoration for transactions tab: `src/pages/BusinessInventory.tsx` (transaction restore logic keyed on active tab and filtered transactions).

### 5) Inventory transaction create/edit (including receipts/media)
Behavior summary (web create):
- Transactions created from inventory have `projectId = null` (business inventory scope).
- Category is required.
- Receipts accept images and PDFs and are uploaded via an offline-aware media service that can produce `offline://` placeholders.
- If receipts were queued while offline, show offline-saved feedback.

Parity evidence:
- Project is forced null: `src/pages/AddBusinessInventoryTransaction.tsx` (sets `projectId = null`, `projectName = null`).
- Category required validation: `src/pages/AddBusinessInventoryTransaction.tsx` (`if (!formData.categoryId?.trim())`).
- Offline-aware receipt uploads + placeholder metadata: `src/pages/AddBusinessInventoryTransaction.tsx` (`OfflineAwareImageService.uploadReceiptAttachment`, `offline://` handling, `useOfflineMediaTracker`).

## Offline-first behavior (mobile target)

### Local source of truth
- UI reads SQLite only.
- Writes apply locally immediately and enqueue outbox ops for later sync.

### Restart behavior
- On cold start, business inventory home should render from local cache (avoid “empty flash”), then converge after delta sync.
  - **Parity evidence (web conceptual)**: business inventory snapshot refresh pattern in `src/contexts/BusinessInventoryRealtimeContext.tsx` (`refreshBusinessInventoryRealtimeSnapshot` seeds, then subscriptions).

### Reconnect + post-sync behavior
- When returning online, inventory scope should refresh collections and clear any stale indicators.
- After outbox flush completes with zero pending ops, refresh inventory scope.
  - **Parity evidence (web)**: `src/contexts/BusinessInventoryRealtimeContext.tsx` listens to `onSyncEvent('complete', ...)` and calls `refreshCollections({ force: true })`.

## Collaboration / “realtime” expectations (mobile target)
- **Intentional delta**: web uses realtime subscriptions for inventory items/transactions (see `src/contexts/BusinessInventoryRealtimeContext.tsx`).
- Mobile must not subscribe to large collections; instead:
  - listen only to `accounts/{accountId}/inventory/meta/sync`
  - on signal change, run delta fetches for advanced collections and apply to SQLite

Canonical migration source:
- `40_features/sync_engine_spec.plan.md` (§ change-signal + delta sync loop)

