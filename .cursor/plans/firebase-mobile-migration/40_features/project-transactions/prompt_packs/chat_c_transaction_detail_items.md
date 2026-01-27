## Prompt Pack — Chat C: `TransactionDetail` items section contract

You are helping migrate Ledger to **React Native + Firebase** with an **offline-first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

### Goal (this chat)

Write the **`TransactionDetail` transaction items section** contract: search/filter/sort, selection + bulk ops, merge behavior, per-item actions/menus, and how it ties to transaction/item entities.

### Outputs (required)

Create/update:
- `40_features/_cross_cutting/ui/components/transaction_items_list.md`
- `40_features/_cross_cutting/ui/components/item_preview_card_actions.md`
- `40_features/project-transactions/ui/screens/transaction_detail.md` (items-related sections; link to the cross-cutting docs)

### Source-of-truth code pointers (parity evidence)

Use these files as the canonical behavior reference:
- `src/components/TransactionItemsList.tsx`
- `src/components/items/ItemPreviewCard.tsx`
- `src/components/items/ItemActionsMenu.tsx`
- `src/pages/TransactionDetail.tsx` (wires the items list; uploads item images; remove-from-transaction hooks)
- `src/components/ui/BulkItemControls.tsx` (bulk controls UI contract, where relevant)

### What to capture (required)

Document:
- **List controls inside TransactionDetail**
  - Search behavior (fields searched, debounce expectations if any)
  - Filter modes (and definitions)
  - Sort modes (and definitions)
  - Sticky controls behavior (when it sticks/unsticks)
- **Selection**
  - Per-row checkbox behavior
  - Select-all behavior (scope: filtered items)
  - Group selection behavior (checked/unchecked/indeterminate)
- **Bulk actions**
  - Delete selected (including partial failure messaging)
  - Set space (single-item vs bulk modal)
  - Set disposition (including special behavior when disposition becomes `inventory`)
  - Set SKU
  - Optional injected bulk action (`bulkAction` prop) and how it behaves
- **Merge behavior**
  - Preconditions (must select 2+)
  - Choose master item
  - Money aggregation rules (which fields sum, formatting)
  - Notes merge rules (bullet list of absorbed items)
  - Post-merge selection state
- **Per-item actions / menus**
  - Which actions are available in `transaction` context vs others
  - Bookmark/duplicate/edit/delete behaviors
  - Add/change/remove transaction (dialog + confirm)
  - Sell/move actions (if exposed here)
  - Disposition badge display rules
- **Images for transaction items**
  - How item image uploads triggered from TransactionDetail are staged and applied
  - Offline placeholder behavior + cleanup requirements
- **States**
  - Empty state for “no items added yet”
  - Errors (bulk action error, bulk delete error, location error)
  - Offline/pending considerations (queued updates; optimistic UI)

### Evidence rule (anti-hallucination)

For each behavior above, add “Observed in …” evidence with file + function/handler name (e.g., `handleConfirmMerge`, `handleBulkDeleteSelected`, `filterMode`, `sortMode`, `openTransactionDialog`, `requestRemoveFromTransaction`).

### Constraints / non-goals

- Do not prescribe Firestore listeners; collaboration must use change-signal + delta.
- No pixel-perfect UI; focus on interaction/state/effects.

