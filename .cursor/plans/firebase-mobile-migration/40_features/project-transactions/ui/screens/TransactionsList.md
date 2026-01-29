# Screen contract: `TransactionsList` (shared module: project + business inventory scopes)

## Intent
Let a user browse transactions in the current workspace scope (project or business inventory) with fast local search/filter/sort, and reliably navigate into transaction detail and back without losing state.

Shared-module requirement:

- `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Inputs
- Route params:
  - `scope`: `'project' | 'inventory'`
  - `projectId` (required when `scope === 'project'`; absent when `scope === 'inventory'`)
- Query params (web parity; mobile equivalent must exist):
  - `txSearch`
  - `txFilter` (reimbursement)
  - `txSource`
  - `txReceipt`
  - `txType`
  - `txPurchaseMethod`
  - `txCategory`
  - `txCompleteness`
  - `txSort`
- Entry points:
  - Project shell → Transactions tab (`ProjectTransactionsPage` renders this) OR Business inventory shell → Transactions tab (wrapper TBD)
  - Return from `TransactionDetail` / `EditTransaction` via stacked back

## Reads (local-first)
- Local DB queries:
  - `transactions` scoped by the active workspace context (project vs inventory), with additional predicates based on selected filters
  - Optional join/read: budget categories (to display category name for **non-canonical** transactions)
  - Required join/read for budget-category filter correctness (new model):
    - If `txCategory` filter is set, include **canonical inventory** transactions when there exists a linked item where:
      - `item.transactionId === transaction.id` AND `item.inheritedBudgetCategoryId === <selectedCategoryId>`
  - Optional derived: transaction completeness (needs-review vs missing items)
- Derived view models:
  - Canonical title mapping for inventory purchase/sale transactions
  - Canonical total computation for canonical transactions (computed from linked items)
- Cached metadata dependencies:
  - Budget categories (for category display and budget-category filter options)

## Writes (local-first)
- User actions generally do not mutate transaction data from the list, except:
  - **Canonical total “self-heal”** may update a transaction amount when computed total differs (web behavior).
    - Local DB mutation: update `transactions.amount`
    - Outbox op: updateTransaction \(transactionId, fields:{amount}\)
    - Change-signal: bump `projects/{projectId}/meta/sync` transactions seq (conceptually)

## UI structure (high level)
- Sticky controls bar:
  - Add menu: Create manually, Import invoice submenu (Wayfair/Amazon routes)
  - Sort menu
  - Filter menu (multi-view submenu)
  - Export button
  - Search field
- Transactions list:
  - Preview cards with title, amount, payment method, date, optional notes, badges (category/type + needs-review/missing-items)

## Budget category semantics (new model; required)

Source of truth:

- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`

Rules:

- **Non-canonical transactions**: category badge/name (if shown) comes from `transaction.category_id`.
- **Canonical inventory transactions** (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`):
  - Should be treated as **uncategorized** on the transaction row (recommend `category_id = null`).
  - If the list shows any category-related badge for canonical rows, it must be **derived** from linked items’ `inheritedBudgetCategoryId` (e.g., “Multiple categories”) and must not require a user-facing “canonical category” selection.

## User actions → behavior (the contract)
- **Open Add menu** → show actions; selecting an action closes menus.
- **Create manually** → navigate to `AddTransaction` in the current scope context.
- **Import invoice** → navigate to import screen in the current scope context (if enabled for that scope).
- **Change sort** → list reorders and state persists.
- **Change filters** → list re-filters and state persists.
- **Search** → list filters by text/amount-like match and state persists.
- **Export** → generate CSV from locally available transactions and share/save it (mobile).
- **Open transaction**:
  - Navigating into a transaction detail records current scroll offset.
  - Returning restores scroll offset and previous list state.
- **Close menus**:
  - Clicking outside closes open menus.
  - Pressing Escape closes open menus.

## States
- Loading:
  - Show loading state while local cache is hydrating and/or initial snapshot is loading.
- Empty:
  - If no transactions match filters/search, show “No transactions found” and hint to adjust filters/search.
- Error:
  - If local DB query fails, show recoverable error state (retry).
- Offline:
  - List should remain usable offline (local-only) and clearly indicate any global “offline” status via global sync UI.
- Pending sync (local writes queued):
  - If a transaction is pending sync, the list should optionally surface a pending marker (depends on global pending UX).
- Permissions denied:
  - If user lacks access to the project, block with a permissions error.
- Quota/media blocked:
  - Not applicable on list screen (handled on form/detail).

## Media (if applicable)
- Not applicable directly; list does not manage media.

## Collaboration / realtime expectations
- While foregrounded in an active scope, list should reflect other users’ changes via change-signal + delta sync.
- No large listeners on `transactions`.

## Performance notes
- Expected dataset sizes:
  - Transactions can be large enough that list operations must be indexed and virtualized as needed.
- Required indexes (SQLite suggestions):
  - `transactions(project_id, transaction_date)`
  - `transactions(project_id, created_at)`
  - `transactions(project_id, category_id)`
  - `transactions(project_id, receipt_emailed)`
  - `transactions(project_id, needs_review)`
  - `transactions(project_id, transaction_type)`
  - `transactions(project_id, payment_method)`
  - For canonical category filtering (new model):
    - `items(transaction_id, inherited_budget_category_id)`
  - Optional: FTS for `source`/`notes`

## Parity evidence
- State persistence (URL params): Observed in `src/pages/TransactionsList.tsx` (`useSearchParams` + sync effects).
- Scroll restoration: Observed in `src/pages/TransactionsList.tsx` (`useStackedNavigate`, restore via `restoreScrollY` state).
- Filters/sorts/search logic: Observed in `src/pages/TransactionsList.tsx` (`filteredTransactions` useMemo + menu UI).
- Export CSV: Observed in `src/pages/TransactionsList.tsx` (`buildTransactionsCsv`, `handleExportCsv`).
- Canonical title + totals + self-heal: Observed in `src/pages/TransactionsList.tsx` (`getCanonicalTransactionTitle`, `computeCanonicalTransactionTotal`, `updateTransaction`).
