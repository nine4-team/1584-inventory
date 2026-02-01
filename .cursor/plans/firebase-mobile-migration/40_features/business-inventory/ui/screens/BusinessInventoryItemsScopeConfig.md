# BusinessInventoryItemsScopeConfig (screen contract — inventory-scope Items module)

## Intent
Define how the shared **Items module** behaves when used in **inventory scope** (business inventory). This doc is **config/delta-only**; the canonical Items behavior lives in `40_features/project-items/`.

## Canonical shared contracts (do not duplicate)
- Items list canonical contract: `40_features/project-items/ui/screens/ProjectItemsList.md`
- Item detail canonical contract: `40_features/project-items/ui/screens/ItemDetail.md`
- Shared-module reuse rule: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Scope config (required shape)
All shared Items screens/components receive a single scope config object per the canonical contract:

- Source of truth: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` → **“Scope config object (contract)”**

Inventory scope config (example):

```ts
const inventoryScopeConfig = {
  scope: 'inventory',
  capabilities: {
    canAllocateToProject: true,
    canGenerateQr: ENABLE_QR, // feature flag / remote config
  },
  fields: {
    showBusinessInventoryLocation: true,
  },
}
```

Notes:

- `projectId` is **absent** when `scope === 'inventory'` (shared modules must not assume it exists).
- Fields/capabilities not specified here use the canonical defaults (e.g. `canExportCsv` defaults to `false`).

Parity evidence (web):

- `capabilities.canAllocateToProject`: Observed in `src/pages/BusinessInventory.tsx` (`unifiedItemsService.batchAllocateItemsToProject(...)`) and `src/pages/BusinessInventoryItemDetail.tsx` (allocation modal + `unifiedItemsService.allocateItemToProject(...)`).
- `capabilities.canGenerateQr`: Observed in `src/pages/BusinessInventory.tsx` (`ENABLE_QR = import.meta.env.VITE_ENABLE_QR === 'true'` + conditional QR button).
- `fields.showBusinessInventoryLocation`: Observed in `src/pages/BusinessInventoryItemDetail.tsx` (search includes `businessInventoryLocation`, and detail renders the Location field).

Out of scope for the config object (intentional):

- Inventory list filter modes, sort modes, duplicate grouping, and action inventories are **inventory-only behaviors** but are specified in this screen contract (below) rather than being modeled as additional config fields. This keeps `ScopeConfig` small and capability-driven.

## Inventory-scope list controls (parity)

### Search
- State key (web parity): `bizItemSearch`.
- Mobile (Expo Router): persist via list state store keyed by `listStateKey = 'inventory:items'` (see `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` → “List state + scroll restoration”).
- Search matches (web parity): description, sku, source, paymentMethod, businessInventoryLocation.

Parity evidence:
- Observed in `src/pages/BusinessInventoryItemDetail.tsx` (search matching logic inside filtered list).

### Filters
Allowed filter modes (inventory scope):
- `all`
- `bookmarked`
- `no-sku`
- `no-description`
- `no-project-price`
- `no-image`
- `no-transaction`

Parity evidence:
- Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_ITEM_FILTER_MODES`).
- Observed in `src/pages/BusinessInventoryItemDetail.tsx` (valid modes list + switch).

### Sort
Allowed sort modes (inventory scope):
- `alphabetical` (by description)
- `creationDate` (newest first)

Parity evidence:
- Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_ITEM_SORT_MODES`).
- Observed in `src/pages/BusinessInventoryItemDetail.tsx` (creation-date sort, newest-first).

### Duplicate grouping
- Inventory items should be groupable by a “duplicate group key” and render collapsed duplicate groups.

Parity evidence:
- Observed in `src/pages/BusinessInventory.tsx` (`getInventoryListGroupKey`, `CollapsedDuplicateGroup`).

## Inventory-scope actions (parity)

### Per-item actions (detail and row/menu)
Inventory scope must include these actions (subject to permissions):
- Bookmark toggle
- Edit item
- Duplicate item (inventory duplicates must remain disposition `inventory`)
- Add to / change transaction; remove from transaction
- Move to project (allocation)
- Change status/disposition
- Delete item (confirm)

Parity evidence:
- Observed in `src/pages/BusinessInventoryItemDetail.tsx` (`ItemActionsMenu` wiring + handlers; duplication sets disposition `inventory`).

### Bulk actions (list)
Inventory scope must support selection and bulk actions:
- Allocate selected items to a project (optional space field)
- Delete selected items
- Generate QR codes for selected items (feature-flag gated)

Parity evidence:
- Batch allocation modal + handler: Observed in `src/pages/BusinessInventory.tsx` (`batchAllocateItemsToProject`, modal with `space`).
- QR flag gate: Observed in `src/pages/BusinessInventory.tsx` (`ENABLE_QR` from `VITE_ENABLE_QR`).

## Offline-first notes (mobile target)
- All list actions must be local-first (SQLite transaction + outbox op) and show pending UI per the shared module contract.
- Allocation operations must be modeled as a single idempotent multi-entity op and follow:
  - `40_features/inventory-operations-and-lineage/README.md`

## Scroll restoration (required; mobile target)

- When navigating from the inventory items list to item detail, record a restore hint for `listStateKey = 'inventory:items'`:
  - preferred: `anchorId = <opened itemId>`
  - optional fallback: `scrollOffset`
- When returning to the list, restore scroll best-effort (anchor-first) and preserve filters/sort/search.

## Parity evidence index (web)
- Inventory list + bulk actions: `src/pages/BusinessInventory.tsx`
- Inventory item detail (actions + allocation + transaction assignment + images + next/prev): `src/pages/BusinessInventoryItemDetail.tsx`
- Inventory item create/edit (quantity + validation + offline errors): `src/pages/AddBusinessInventoryItem.tsx`, `src/pages/EditBusinessInventoryItem.tsx`

