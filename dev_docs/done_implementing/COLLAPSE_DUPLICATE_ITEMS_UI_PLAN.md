# Collapse Duplicate Items in UI (Preserve Individual Objects)

### Summary
We want to **reduce visual clutter** anywhere the app renders a list of items that can contain duplicates (e.g., “24 pillows”), while **preserving individual item objects** in the data model and backend. The UI should collapse duplicates into a **single card** showing a **quantity indicator** and a **chevron** to expand, plus small microcopy like “Expand to view all items”.

This document defines:
- **Where** duplicates are currently shown (audit results)
- The **UX pattern** for grouped items
- The **grouping key** rules (what counts as “duplicate”)
- A **reusable component approach** to normalize item rendering across the app
- A **phased implementation plan**, edge cases, and acceptance criteria

---

## Goals / Non-goals

### Goals
- **Collapse duplicates by default** in item list UIs where duplicates are common.
- **Preserve all individual item records** (and their IDs, lineage, images, disposition, etc.).
- Provide a clear, consistent interaction:
  - **Quantity badge** (e.g., “×24”)
  - **Chevron** toggle to expand/collapse
  - **Microcopy** (subtle) to communicate “Expand to view all items”
- **Normalize item rendering** across the app to reduce confusion and code duplication, especially between:
  - Inventory list views (project + business inventory)
  - Transaction detail item grids/cards
  - Transaction create/edit item cards (`TransactionItemsList`)

### Non-goals
- No schema change required (grouping is **presentation-only**).
- No change to how duplication is stored or how transactions allocate/deallocate items.
- Not replacing “Merge Selected” behavior in `TransactionItemsList` (merging is a **data transformation**; grouping is **display-only**).

---

## Audit: item list surfaces that can include duplicates

### Confirmed “must handle” surfaces
- **Project item list**: `src/pages/ProjectItemsPage.tsx` (wrapper) → `src/pages/InventoryList.tsx` (actual list renderer)
- **Business inventory item list**: `src/pages/BusinessInventory.tsx` (items tab)
- **Wayfair import preview list**: `src/pages/ImportWayfairInvoice.tsx` uses `src/components/TransactionItemsList.tsx`
- **Transaction create**: `src/pages/AddTransaction.tsx` uses `src/components/TransactionItemsList.tsx`
- **Transaction edit**: `src/pages/EditTransaction.tsx` loads transaction items; edit UI uses item editor (and in some flows also uses `TransactionItemsList`)
- **Transaction detail**: `src/pages/TransactionDetail.tsx` renders `Item[]` cards via `renderItemCard` for “In this project” and “Moved”

### Discovered “optional / later” surfaces (duplicates possible but less UX pain)
- **Project invoice printable view**: `src/pages/ProjectInvoice.tsx` renders item descriptions in invoice line items.
  - This is print-oriented and compact already; we should treat grouping as optional and only if it improves readability without hiding necessary detail.

---

## UX Spec: “Collapsed duplicate group card”

### Visual structure (collapsed state)
One visual card/row representing a group:
- **Primary content**: representative image + description, plus the same price/source/SKU row shown in the individual item row.
  - Do **not** surface location, bookmark, disposition badges, or notes in the collapsed header; expanding is required to see them.
- **Quantity badge**: “×N” (N = number of items in group)
  - Placed near top-right (or aligned with existing status/disposition badges).
- **Chevron**: indicates expand/collapse.
- **Microcopy** (small, subtle, non-clickbait):
  - Example: “Expand to view all items” (only shown when group size > 1)

### Expanded state
Expanding a group reveals the **existing per-item UI** (the same cards/rows as today) for each item in the group.
- The group header stays visible.
- Items show as a nested list with slight indentation or a subtle border.

### Interactions & accessibility
- Entire group header is clickable to toggle, except for explicit controls.
- Group-level checkbox lives inside the header and mirrors the per-item checkbox styling/behavior (checked, unchecked, indeterminate). Toggling it selects/deselects all children without forcing an expand.
- Keyboard and a11y:
  - Toggle button uses `button` element
  - `aria-expanded`, `aria-controls`
  - “Expand group: <description>, <N> items” label
- Persist expansion:
  - Expansion state should be **local to the page** (not persisted in DB).
  - Keep expanded state stable across minor updates (e.g., realtime item refresh) by keying it on the group key.

---

## What counts as a “duplicate”? (Grouping key rules)

We need grouping rules that are:
- **Predictable** (user expectations)
- **Safe** (don’t hide meaningful differences)
- **Context-sensitive** (inventory list vs transaction form vs transaction detail)

### Principle
Only group items that are **visually identical in the collapsed summary**, so expanding doesn’t reveal surprising differences.

### Context: InventoryList / BusinessInventory list (persisted `Item`)
Group key should include the fields we show in the row summary, so “different looking” items don’t collapse together.

Recommended grouping key (v1):
- **Primary grouping**: `sku` (non-null only - items with null/empty SKU are not grouped)
- `source` (or empty)
- `effectivePrice` = `projectPrice ?? purchasePrice ?? ''` (string normalized)
- `locationField`
  - Project list: `space ?? ''`
  - Business inventory list: `businessInventoryLocation ?? ''`
- `disposition` (normalized via existing `normalizeDisposition`)
- `bookmark` (boolean)

Notes:
- Items with null/empty SKU are **not grouped** (each appears individually).
- We intentionally do **not** include `itemId` (would defeat grouping).
- We intentionally do **not** include image URLs; the group header can show the first item’s primary image as a representative.
- Grouping is based on SKU rather than description to ensure items with the same SKU are grouped together regardless of description variations.

### Context: TransactionItemsList (form `TransactionItemFormData`)
Transaction items can be duplicated (especially from Wayfair imports). They are not persisted yet, so we can add a **UI-only group key** reliably.

Recommended approach:
- Add optional UI-only field: `uiGroupKey?: string` on `TransactionItemFormData`.
  - For Wayfair: set `uiGroupKey` from the line item identity (e.g., source line index + sku + base description), so grouping doesn’t depend on parsing “(1/24)” suffix.
  - For manual items: default `uiGroupKey` computed from sku + price fields (items with null/empty SKU are not grouped).

### Context: TransactionDetail (persisted `Item`)
Same as inventory lists, but we must **not** group across sections:
- Group within “In this project” separately from “Moved”
- Keep “Moved” opacity/badge behavior at group level

---

## Component architecture (normalize item rendering across app)

The app currently renders item summaries in multiple bespoke implementations:
- `InventoryList.tsx` list rows (with selection + actions)
- `BusinessInventory.tsx` list rows (nearly identical to `InventoryList`)
- `TransactionDetail.tsx` `renderItemCard` grid cards (already intentionally mimics inventory styling)
- `TransactionItemsList.tsx` form cards (different layout + merge/selection)

### Proposed reusable building blocks (self-evident naming)

#### 1) `getDuplicateItemGroupKey(...)` utilities
- `src/utils/itemGrouping.ts`
  - `getInventoryListGroupKey(item: Item, context: 'project' | 'businessInventory'): string`
  - `getTransactionFormGroupKey(item: TransactionItemFormData): string`
  - `stripWayfairQtySuffix(description: string): string` (only if needed; prefer `uiGroupKey`)

#### 2) `CollapsedDuplicateGroup` UI primitive
- `src/components/ui/CollapsedDuplicateGroup.tsx`
  - Props:
    - `groupId: string`
    - `count: number`
    - `summary: ReactNode` (header content)
    - `children: ReactNode` (expanded items)
    - `defaultExpanded?: boolean`
    - `microcopy?: string` (default “Expand to view all items”)

#### 3) Page-specific “item row/card” extraction (reduce duplication)
To avoid re-implementing the exact complex row markup twice:
- Extract the per-item row renderer used by both:
  - `InventoryList.tsx`
  - `BusinessInventory.tsx`

Suggested:
- `src/components/items/InventoryItemRow.tsx`
  - Renders **one** `Item` row with existing controls (checkbox, bookmark, edit, duplicate, disposition menu, image placeholder, etc.)
  - Makes group integration easy: a group just renders multiple `InventoryItemRow` children.

For transaction detail:
- Extract `TransactionDetailItemCard` (or reuse `InventoryItemRow` with a “card mode” later).

---

## Implementation plan (phased)

### Phase 1 — Project + Business inventory lists (highest impact)
Applies to:
- `src/pages/InventoryList.tsx`
- `src/pages/BusinessInventory.tsx` (items tab)

Steps:
- Compute `filteredItems` as today.
- Group `filteredItems` into ordered groups:
  - Stable ordering: keep original list order, but collapse duplicates into the first instance’s position.
- Render:
  - If group size == 1 → render existing per-item row unchanged
  - If group size > 1 → render `CollapsedDuplicateGroup` header row + expanded children rows

Selection behavior (v1 recommendation):
- Collapsed header shows a checkbox with **tri-state** behavior:
  - Checked if all items in group are selected
  - Unchecked if none
  - Indeterminate if some
- Clicking header checkbox toggles selection for all items in the group.

### Phase 2 — Wayfair import preview (reduce clutter at the source)
Applies to:
- `src/pages/ImportWayfairInvoice.tsx` → `TransactionItemsList`

Steps:
- When building imported items, set `uiGroupKey` so duplicates are naturally groupable without parsing text.
- Update `TransactionItemsList` to render grouped preview by default.

### Phase 3 — Transaction create/edit (normalize the app)
Applies to:
- `src/pages/AddTransaction.tsx`
- `src/pages/EditTransaction.tsx` (where applicable)
- `src/components/TransactionItemsList.tsx`

Steps:
- Add grouped rendering path to `TransactionItemsList`:
  - Group header shows description + count + chevron
  - Expanding shows the existing per-item card UI
- Merge/selection interactions:
  - Keep “Merge Selected” operating on **actual underlying item IDs**.
  - If a group is collapsed, selecting the group can select all children (same tri-state behavior).

### Phase 4 — Transaction detail (consistency + reduced clutter)
Applies to:
- `src/pages/TransactionDetail.tsx`

Steps:
- Group items separately within:
  - “In this project”
  - “Moved”
- Render group header using the same summary card style as `renderItemCard`, with:
  - quantity badge
  - chevron
  - “Moved” badge if applicable to that section

### Phase 5 — Optional: Invoice view
Applies to:
- `src/pages/ProjectInvoice.tsx`

Recommendation:
- Keep as-is initially (print views often benefit from explicit detail).
- If needed later, group only when there are high-count repeats and ensure print output remains clear (e.g., “Pillow ×24”).

---

## Edge cases / risks

- **Items that look similar but differ meaningfully**:
  - Mitigation: grouping key includes the fields shown in collapsed summary (price, sku, disposition, location, bookmark).
- **Wayfair “(1/24)” suffix**:
  - Prefer explicit `uiGroupKey` on form items to avoid brittle string parsing.
- **Realtime updates**:
  - Expansion state should be keyed on group ID so the UI doesn’t “snap shut” on updates.
- **Bulk actions** (delete, allocate):
  - Group selection must correctly map to underlying item IDs.

---

## Acceptance criteria

- In project item lists and business inventory item lists:
  - 24 duplicates render as **1 row/card** with **“×24”** and a **chevron**.
  - Expanding shows all 24 items with existing per-item controls.
  - Selecting the group toggles selection of all items in that group.
- In Wayfair import preview and transaction create/edit:
  - Duplicate items are grouped by default and expandable.
  - Editing still applies to the correct underlying item.
- In transaction detail:
  - Duplicates are grouped within each section (“In this project” and “Moved”).

---

## Open questions (need product decision)

1) **Should grouping ignore bookmark state?**
   - If we group items with mixed bookmark state, the header needs a “partial bookmarked” indicator.
   - v1 recommendation: include bookmark in the grouping key for simplicity.

2) **Should the collapsed header expose the same action buttons (edit/duplicate/disposition) or force expand first?**
   - v1 recommendation: keep header actions minimal; require expand for per-item actions to avoid ambiguity.

3) **Default expansion behavior**
   - Always collapsed by default vs “auto-expand if group size <= 3”.
   - v1 recommendation: always collapsed (consistent, predictable).

