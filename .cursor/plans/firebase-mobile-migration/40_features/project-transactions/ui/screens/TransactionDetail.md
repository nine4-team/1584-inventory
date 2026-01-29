# Screen contract: `TransactionDetail` (shared module: project + business inventory scopes)

## Intent
Display and manage a single transaction: core fields, receipts/other images (with gallery + pinning), and transaction items (“itemization”) with predictable offline behavior and clear cross-scope action constraints.

Shared-module requirement:

- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Inputs
- Route params:
  - `scope`: `'project' | 'inventory'`
  - `projectId` (required when `scope === 'project'`; absent when `scope === 'inventory'`)
  - `transactionId`
- Query params:
  - `returnTo` (optional back destination)
- Entry points:
  - Transactions list → transaction detail
  - Cross-context links (e.g. item detail → transaction)

## Reads (local-first)
- Local DB queries:
  - Transaction by `transactionId`
  - Project by `projectId` (for display and routing; only when `scope === 'project'`)
  - Budget categories (for category display and itemization-enabled determination)
  - Transaction items (items linked to this transaction), plus “moved out” items for the moved section
  - Optional: lineage edges/flags used by cross-scope actions
- Derived view models:
  - Canonical title mapping
  - Canonical total computation (canonical sale/purchase) for display
  - Gallery images set is derived from receipts + other images (excluding non-image receipt attachments like PDFs)
- Cached metadata dependencies:
  - Budget categories (and any itemization rules attached to them)

## Canonical vs non-canonical budget category semantics (new model; required)

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

Rules:

- **Non-canonical**: display category name from `transaction.category_id` and use it for itemization enablement.
- **Canonical inventory** (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`):
  - Treat the transaction row as **uncategorized** (recommend `category_id = null`).
  - Display category as “Uncategorized” or omit the category row entirely (choose one UI pattern and keep consistent).
  - Any budgeting attribution related to canonical rows is **item-driven** via linked items’ `inheritedBudgetCategoryId` (no “canonical category” picker).

## Writes (local-first)

### Transaction-level actions
- Add receipt(s):
  - Local DB: append `receiptImages[]` (and mirror legacy `transactionImages[]` for compatibility)
  - Outbox: upload media (if placeholder) + update transaction arrays
- Add other image(s):
  - Local DB: append `otherImages[]`
  - Outbox: upload media (if placeholder) + update transaction arrays
- Delete receipt/other image:
  - Local DB: remove image from corresponding array
  - If image is `offline://<mediaId>`, delete local blob file immediately
  - Outbox: update transaction arrays (and remote delete if applicable)
- Pin/unpin image:
  - Local UI-only state; does not mutate the transaction record.
- Edit transaction:
  - Navigate to `EditTransaction` screen.
- Move transaction to project / business inventory:
  - Emits multi-entity server-owned operations; behavior depends on `40_features/inventory-operations-and-lineage/feature_spec.md`.
- Delete transaction:
  - Requires explicit confirmation.
  - Local DB: delete transaction row; locally unlink any items as needed.
  - Outbox: deleteTransaction op.

### Itemization actions (transaction items)
TransactionDetail wires a rich `TransactionItemsList` surface, including:
- Create item(s) (draft → persisted)
- Add existing items to this transaction
- Update item fields
- Duplicate items
- Delete items (single and bulk)
- Remove item from this transaction (unlink)
- Set space/location for selected items
- Cross-scope actions (move/sell to project/business inventory)

Each of these must be represented as local DB mutations plus durable, idempotent outbox ops.

### New requirement: item linking updates `inheritedBudgetCategoryId` (non-canonical only)

When the user links/assigns items to this transaction:

- If the transaction is **non-canonical** and has a non-null `category_id`, set:
  - `item.inheritedBudgetCategoryId = transaction.category_id`
- If the transaction is **canonical inventory** (`INV_*`), do **not** overwrite `item.inheritedBudgetCategoryId`.

## UI structure (high level)
- Header:
  - Back + optional Retry Sync button
  - Transaction actions menu (Edit / Move / Delete)
- Details section:
  - Category, source, amount, tax/subtotal, date, payment method, status, reimbursement, receipt emailed, notes
- Receipts section:
  - “Add receipts” action
  - Tile preview grid with remove + pin + click-to-open-gallery
  - Upload activity indicator
- Other images section (only if any exist):
  - Same as receipts, but images-only
- Transaction items section (itemization):
  - Visible when itemization is enabled OR items exist
  - If disabled but items exist: show warning
  - Current items list + moved items list (read-only-ish/opacity)
  - Bulk selection + bulk actions + per-item menus
- Optional audit section (only when itemization enabled and not canonical sale/purchase)
- Metadata footer with delete button
- Image gallery modal (full screen)
- Move dialogs (move transaction to project; move/sell item dialogs)

## User actions → behavior (the contract)
- **View transaction**:
  - Shows last-known local state immediately.
  - Converges to freshest state via delta when online.
- **Add receipts / other images**:
  - Accepts multiple files.
  - Upload is sequential to track offline media IDs deterministically.
  - UI updates immediately to show new tiles.
  - If offline or placeholders exist, queue the update; show “saved offline” feedback.
- **Delete receipt / other image**:
  - Removes tile immediately.
  - If tile is an offline placeholder, deletes the local file blob.
- **Open gallery**:
  - Clicking a tile opens gallery on that image index.
  - Esc resets zoom before close (gallery contract).
  - Supports optional “Pin” action; pinning reveals a pinned image panel on this screen.
- **Itemization rules**:
  - If itemization disabled and there are no items: hide items section.
  - If itemization disabled but there are existing items: show items with a warning.
- **Transaction actions menu**:
  - Edit navigates to edit form.
  - Move is disabled for canonical inventory sale/purchase transactions.
  - Delete triggers explicit confirmation.

## States
- Loading:
  - Loading indicator while the transaction and/or items are being hydrated.
- Empty:
  - Not applicable; missing transaction becomes “not found”.
- Error:
  - If transaction load fails, show recoverable error state.
- Offline:
  - Screen remains fully navigable; uploads may be queued with placeholders.
- Pending sync:
  - When offline uploads/updates occur, show clear “saved offline / pending sync” feedback.
- Permissions denied:
  - If user lacks account membership/permission to view/edit, block with permissions error.
- Quota/media blocked:
  - If storage quota blocks new media, show explicit message and block picker.

## Media (if applicable)
- Receipts can include PDFs; receipt PDFs are not included in the image gallery set (images-only).
- Offline placeholders use `offline://<mediaId>`.
- Tile previews must resolve offline placeholders to local blob URLs.

## Collaboration / realtime expectations
- While foregrounded, changes from other devices should reflect via change-signal + delta.
- No listeners on large collections.

## Performance notes
- Avoid N+1 network calls for completeness/lineage in mobile implementation; rely on local DB joins/derived tables.
- Itemization list may require virtualization and debounced search in large transactions.

## Parity evidence
- Receipts section UI + add/upload indicator: Observed in `src/pages/TransactionDetail.tsx` (Receipts block, `UploadActivityIndicator`).
- Offline placeholder upload + local update + queue: Observed in `src/pages/TransactionDetail.tsx` (`handleReceiptsUpload`, `offlineStore.saveTransactions`, `offlineTransactionService.updateTransaction`).
- Delete receipt/other incl. offline placeholder file cleanup: Observed in `src/pages/TransactionDetail.tsx` (`offlineMediaService.deleteMediaFile`).
- Other images conditional section: Observed in `src/pages/TransactionDetail.tsx` (conditional render).
- Gallery modal: Observed in `src/components/ui/ImageGallery.tsx` and wired from `src/pages/TransactionDetail.tsx`.
- Actions menu constraints: Observed in `src/components/transactions/TransactionActionsMenu.tsx` (canonical sale/purchase disables move).
- Itemization section + warning when disabled but items exist: Observed in `src/pages/TransactionDetail.tsx`.
- Rich itemization surface: Observed in `src/components/TransactionItemsList.tsx` (bulk selection, filters, cross-scope actions).
