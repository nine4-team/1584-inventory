---
name: space_items_ui_parity
overview: Replace Space Detail’s “Associated Items” section with a “Space Items” experience that reuses the Transaction Items UI (search/filter/sort/selection/duplicate-grouping/edit/create/add-existing), while intentionally omitting transaction-specific actions and using a safer bulk action (“Remove from space”).
todos:
  - id: locate-and-replace-section
    content: Update `SpaceDetail.tsx` to rename “Associated Items” to “Space Items” and replace the grid with a configurable `TransactionItemsList` inside a stable container.
    status: pending
  - id: item-mapping-layer
    content: Add helper mapping between `Item` and `TransactionItemFormData` for Space Items usage (and reverse mapping for update payloads).
    status: pending
  - id: transactionitemslist-config
    content: Add props to `TransactionItemsList` for `enableTransactionActions`, custom `bulkAction` label/handler, and `sentinelId` to support Space context without forking UI.
    status: pending
  - id: wire-space-create-edit-duplicate
    content: In `SpaceDetail`, implement `onAddItem`, `onUpdateItem`, and `onDuplicateItem` to persist items with the current `spaceId` and refresh the list.
    status: pending
  - id: space-item-picker
    content: Create `SpaceItemPicker` modal and wire `onAddExistingItems` so users can assign existing project items to the current space.
    status: pending
  - id: bulk-remove-from-space
    content: Implement bulk unassign (`space_id = null`) for selected items and ensure selection clears + list refreshes.
    status: pending
  - id: manual-regression-pass
    content: "Manually verify parity: controls, sticky behavior, search/filter/sort, grouping, per-item actions (minus transaction actions), picker flow, and bulk remove-from-space."
    status: pending
isProject: false
---

# Space Items UX parity plan

## What we’re starting from

- Space detail currently renders a simple grid of `ItemPreviewCard` under “Associated Items” in `SpaceDetail.tsx`:
```410:428:/Users/benjaminmackenzie/Dev/ledger/src/pages/SpaceDetail.tsx
      {/* Associated items */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Associated Items ({associatedItems.length})
        </h2>
        {associatedItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {associatedItems.map(item => (
              <ItemPreviewCard
                key={item.itemId}
                item={item}
                projectId={projectId}
              />
            ))}
          </div>
        ) : (
          <p className="text-gray-400 italic">No items in this space</p>
        )}
      </div>
```

- Transaction items UX is centralized in `TransactionItemsList.tsx`, which already encapsulates the “continuity” surface (add/create, add existing, filter/sort/search, select all, grouped duplicates, per-item actions, bulk controls, sticky behavior).

## Key decisions (locked in)

- **Bulk destructive action**: Use **“Remove from space”** (set `items.space_id = null`) instead of permanent delete.
- **Transaction actions**: **Hide** transaction-related actions (Assign/Change Transaction, Remove from Transaction) in Space Items.

## Implementation approach

### 1) Rename and replace the section in `SpaceDetail`

- Update the section title from **“Associated Items” → “Space Items”**.
- Replace the current grid with a `TransactionItemsList` instance.
- Add a stable container wrapper and pass a `containerId` for sticky/bulk width tracking.

### 2) Map `Item[]` ↔ `TransactionItemFormData[]`

`SpaceDetail` owns `associatedItems: Item[]`, but `TransactionItemsList` expects `TransactionItemFormData[]`.

- Add a small mapping layer (prefer a helper in `src/utils/` so it’s reusable):
  - `Item.itemId → TransactionItemFormData.id`
  - carry through: `description`, `sku`, `purchasePrice`, `projectPrice`, `marketValue`, `notes`, `images`, `disposition`, `space` (human-readable if present)
  - preserve `transactionId` on the data model (but we will **not** surface actions for it)
- For edits/saves coming back out of `TransactionItemForm`, map back to an `updateItem(...)` payload.

### 3) Make `TransactionItemsList` configurable for “Space context”

Right now, `TransactionItemsList` always wires transaction actions in `renderTransactionItem`.

Example:

```776:807:/Users/benjaminmackenzie/Dev/ledger/src/components/TransactionItemsList.tsx
    return (
      <ItemPreviewCard
        key={item.id}
        item={previewData}
        // ...
        onAddToTransaction={enablePersistedControls ? () => openTransactionDialog(item.id) : undefined}
        onRemoveFromTransaction={
          item.transactionId
            ? (itemId) => requestRemoveFromTransaction(itemId)
            : undefined
        }
        // ...
      />
    )
```

Add minimal props to support Space Items without forking UI:

- `context?: 'transaction' | 'space'` (or a few explicit booleans)
- `enableTransactionActions?: boolean` default `true`
- `bulkAction?: { label: string; onRun: (selectedIds: string[], selectedItems: TransactionItemFormData[]) => Promise<void> }`
- `sentinelId?: string` default `'transaction-items-sentinel'` (prevents ID collisions and allows Space Items to have its own sentinel)

Space Items will pass:

- `enableTransactionActions={false}`
- `bulkAction={{ label: 'Remove from space', onRun: bulkUnassignSpace }}`
- `context="space"` (so `ItemPreviewCard` can adjust any context-specific affordances if needed)

### 4) Wire “Create item” and “Edit item” to persist with `space_id`

In `SpaceDetail`, provide callbacks into `TransactionItemsList`:

- **Create**: `onAddItem` calls `unifiedItemsService.createItem(...)` with `projectId` + `spaceId` (current space)
- **Edit**: `onUpdateItem` calls `unifiedItemsService.updateItem(...)` for that item ID
- After mutations: refresh `associatedItems` (reuse the existing fetch path already used in `SpaceDetail`)

### 5) Implement “Add existing” for Space Items (picker modal)

Transaction flows use a dedicated picker modal to attach existing items.

For Space Items parity:

- Add a new component: `src/components/spaces/SpaceItemPicker.tsx` (can copy structure/UX from the transaction picker and reuse `ItemPreviewCard` + selection patterns).
- It should list project items (optionally filter out already-in-this-space items), support selection, and confirm.
- On confirm: batch-update selected items via `unifiedItemsService.updateItem(accountId, itemId, { spaceId })`.
- Connect it via `TransactionItemsList`’s existing `onAddExistingItems` hook (SpaceDetail opens the picker).

### 6) Bulk “Remove from space” behavior

Implement bulk unassign as:

- For each selected item: `unifiedItemsService.updateItem(accountId, itemId, { spaceId: null })`
- Refresh the space items list and clear selection.
- Ensure the bulk controls label reads **“Remove from space”** (via the new `bulkAction` prop).

### 7) Keep visuals and behavior aligned

- Ensure Space Items uses the same:
  - sticky top control bar
  - search/filter/sort UI
  - grouped duplicates (`CollapsedDuplicateGroup`)
  - per-item edit/duplicate/bookmark/status (where applicable)
  - totals/footer row (item count + subtotal) unless there’s a reason to omit everywhere

## Test plan (manual)

- In Space detail, “Space Items” section:
  - Create item → item appears in the space.
  - Edit item → updates persist.
  - Duplicate item → duplicates remain assigned to this space.
  - Add existing → selected items get `space_id` set and appear.
  - Search/filter/sort behave identically to transaction items.
  - Select items → bulk action shows **Remove from space** and unassigns items.
  - Verify no transaction actions are shown in the per-item menu from Space Items.