## Space Detail: “Space Items” UX parity with “Transaction Items”

### Goal
In `SpaceDetail`, make the **Space Items** section feel **identical (or as close as possible)** to the **Transaction Items** section users interact with inside `TransactionDetail`.

Practical meaning: if someone learns “item management” while inside a transaction, they should not have to re-learn anything when managing items inside a space.

### Current source-of-truth UX (Transaction Items)
The current Transaction Items experience is implemented by:

- `src/pages/TransactionDetail.tsx` (the “Transaction Items” section container + “Add Existing Items” modal)
- `src/components/TransactionItemsList.tsx` (the list UX: add/create, add existing, search, filter, sort, select-all, grouped duplicates, per-item actions, bulk delete, sticky behavior)
- `src/components/items/ItemPreviewCard.tsx` (row/card UI + per-item action menu; invoked by `TransactionItemsList`)
- `src/components/transactions/TransactionItemPicker.tsx` (modal that lets you add existing items into a transaction)

### Current Space Detail UX (what we’re replacing)
`src/pages/SpaceDetail.tsx` currently renders “Associated Items” as a **simple grid of `ItemPreviewCard`s** with:

- No **search/filter/sort**
- No **selection / select-all**
- No **add existing / create item**
- No **bulk actions**
- No **consistent per-item action surface** (it’s not wired the way `TransactionItemsList` wires it)

### What “parity” should include (feature inventory)
This is the feature/interaction surface the Transaction Items section provides today. “Space Items” should match these where they make sense in a space context.

- **Top control bar (sticky)**
  - **Add Item** (with the same behavior: “Create item” and, when available, “Add existing”)
  - **Sort** (same UI and same modes)
  - **Filter** (same UI and same modes)
  - **Search** (same input + behavior)
  - **Select all** checkbox and per-item selection checkboxes

- **Item row/card behavior**
  - Same `ItemPreviewCard` layout and density
  - Same duplicate-group collapsing behavior (`CollapsedDuplicateGroup`)
  - Same “tap/click opens item detail” behavior (Transaction Items opens `ItemDetail` inline)
  - Same per-item actions that are applicable:
    - Bookmark toggle
    - Duplicate (including “duplicate count” UI for grouped duplicates)
    - Edit
    - Change disposition/status
    - Assign/change transaction (if item is persisted and project context exists)
    - Remove from transaction (if the item is linked to a transaction)
    - Move/sell actions (if those are part of your intended “item management” surface)
    - Delete (persisted items)

- **Footer/bulk controls**
  - Bulk delete selected items
  - Same sticky/containment behavior for bulk controls (list needs a container width reference)

- **Totals / metadata row**
  - Transaction Items shows:
    - Total Items count (and filtered count)
    - Calculated Subtotal (based on item prices)
  - Space Items should match this display (or intentionally omit it everywhere)

### Key design decision: reuse vs duplicate
To achieve true “same experience,” the most reliable approach is:

- **Reuse `TransactionItemsList`** for Space Items, rather than re-implementing similar controls in `SpaceDetail`.

That implies Space Items must be able to provide the same kinds of callbacks and state updates that `TransactionDetail` provides.

### What has to happen (implementation checklist)

### 1) Replace the Space Detail “Associated Items” UI with `TransactionItemsList`
- **Change the section title** to **“Space Items”** (Title Case).
- Replace the current grid with a `TransactionItemsList` instance, inside a container element with a stable `containerId` (mirrors `TransactionDetail`’s `containerId="transaction-items-container"` pattern).
- Add a sentinel element (or equivalent) if you want the same sticky behavior logic to work consistently.

### 2) Provide the correct “items” data shape
`SpaceDetail` currently has `Item[]`. `TransactionItemsList` expects `TransactionItemFormData[]`.

To use `TransactionItemsList`, implement a **mapping layer**:

- **Item → TransactionItemFormData**
  - `id`: `item.itemId`
  - `description`, `sku`, `purchasePrice`, `projectPrice`, `marketValue`, `notes`
  - `images`
  - `disposition`
  - `transactionId` (so “transaction” actions can appear consistently)
  - `space` (human-readable name if available) and/or add support for `spaceId` if needed for parity

Important: Space Items are persisted items (they have real IDs), so the “persisted-only” affordances in `TransactionItemsList` should remain enabled.

### 3) Wire up create/edit/duplicate so the controls behave the same
To match Transaction Items, Space Items must support the same flows:

- **Create item in this space**
  - Provide `onAddItem` to `TransactionItemsList`.
  - The handler should create an item via `unifiedItemsService.createItem(...)` with:
    - `projectId` = current project
    - `spaceId` = current space
    - any other required inventory fields (mirroring how items are created elsewhere)

- **Edit item**
  - Provide `onUpdateItem` to persist edits (via `unifiedItemsService.updateItem(...)`).

- **Duplicate item**
  - Provide `onDuplicateItem` (or reuse the same duplication approach as the transaction section).
  - Ensure duplicates inherit `spaceId` so they remain in this space.

### 4) Implement “Add existing” for space (the big missing piece)
Transaction Items uses `TransactionItemPicker` in a modal to add existing items to a transaction.

Space Items needs an equivalent modal/picker, but with “assign to this space” semantics:

- **Create a new picker component** (recommended) similar to `TransactionItemPicker`, e.g.
  - `SpaceItemPicker` (name TBD)
  - Tabs can be simpler than transaction (at minimum: project items). If you want parity, reuse the same style and grouping UX.
- **Selection behavior**
  - Same selection UX: checkboxes, grouped duplicates, “Select all,” sticky “Add Selected” bar.
- **Mutation on confirm**
  - For each selected item: `unifiedItemsService.updateItem(accountId, itemId, { spaceId: currentSpaceId })`
  - Consider batching with `Promise.all` like other flows.
- **Post-mutation refresh**
  - Refresh the space’s item list so the `TransactionItemsList` updates.
  - Prefer using an existing realtime refresh path (if available) or re-run the same fetch logic Space Detail uses today.

Optional but highly consistent: support “remove from this space” in the picker (or as a separate bulk action) by setting `spaceId: null`.

### 5) Ensure per-item “transaction” actions make sense in space context
In Transaction Items, “Remove from transaction” refers to “this transaction.”
In Space Items, there is no “this transaction,” but the action can still work if it means:

- **Remove the item from whichever transaction it is currently linked to**
  - Implement this using `unifiedItemsService.unlinkItemFromTransaction(accountId, item.transactionId, itemId, { itemCurrentTransactionId: item.transactionId })`
  - You can still reuse the same confirm dialog UX so it feels identical.

Also verify:

- **Change Transaction / Assign to Transaction** works from Space Items (it should, as long as `projectId` exists and item is persisted).

### 6) Match bulk-controls behavior (delete selected, etc.)
Transaction Items currently uses `BulkItemControls` for **bulk delete selected items** (and disables assign/set-space/disposition/SKU).

To match exactly:

- Implement a **bulk delete handler** for Space Items and pass it through `TransactionItemsList` (or mirror its internal bulk delete flow).
- Decide whether “delete” is truly “relevant” in the Space context.
  - If deletion is too dangerous, consider substituting “Remove from space” (set `spaceId: null`) — but note this will diverge from Transaction Items unless Transaction Items also adopts that language.

### 7) Keep the visual/sticky behavior consistent
Transaction Items relies on:

- A known `containerId` for width tracking
- A sentinel element to decide when sticky controls should stop sticking

To match behavior:

- Add analogous container and sentinel IDs in Space Detail around Space Items.

### 8) Make filtering/sorting/search behavior consistent
If Space Items reuses `TransactionItemsList`, these come “for free,” but you should validate:

- The search fields match what users expect in space context (description, SKU, notes, space label, etc.).
- Filters that refer to transaction state (“no-image”, “no-project-price”, etc.) still make sense.
  - If a filter mode doesn’t make sense for spaces, either:
    - keep it anyway for parity, or
    - remove it everywhere (Transaction Items + Space Items) to avoid divergence.

### 9) Testing / regression checklist
At minimum, validate:

- **Space Items renders** and matches Transaction Items UI (controls + row layout).
- **Create item** adds an item into the space and it appears immediately.
- **Add existing** assigns selected existing items to the space.
- **Edit item** updates correctly.
- **Duplicate item** creates duplicates that stay in the space.
- **Search/filter/sort** behave identically to Transaction Items.
- **Selection + bulk delete** works (and clears selection, updates list).
- **Transaction actions** (assign/change/remove) behave sensibly from the space context.

### Recommended sequencing (to reduce risk)
- **Phase 1 (UI parity shell)**: Replace Space section with `TransactionItemsList` using mapped items, but disable “Add existing” and creation initially if needed.
- **Phase 2 (item mutations)**: Implement create/edit/duplicate wired to the existing services.
- **Phase 3 (picker parity)**: Add the Space “Add existing” modal/picker and wire bulk space assignment.
- **Phase 4 (polish)**: Align sticky behavior, totals row, and confirm dialogs to be pixel-identical.

