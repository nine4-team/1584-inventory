# BusinessInventoryTransactionsScopeConfig (screen contract — inventory-scope Transactions module)

## Intent
Define how the shared **Transactions module** behaves when used in **inventory scope** (business inventory). This doc is **config/delta-only**; the canonical Transactions behavior lives in `40_features/project-transactions/`.

## Canonical shared contracts (do not duplicate)
- Transactions list canonical contract: `40_features/project-transactions/ui/screens/TransactionsList.md`
- Transaction form canonical contract: `40_features/project-transactions/ui/screens/TransactionForm.md`
- Transaction detail canonical contract: `40_features/project-transactions/ui/screens/TransactionDetail.md`
- Shared-module reuse rule: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Scope config (required shape)
All shared Transactions screens/components receive a single scope config object per the canonical contract:

- Source of truth: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` → **“Scope config object (contract)”**

Inventory scope config (example):

```ts
const inventoryScopeConfig = {
  scope: 'inventory',
  capabilities: {
    canExportCsv: false,
    supportsInventoryOnlyStatusFilter: true,
  },
}
```

Notes:

- `projectId` is **absent** when `scope === 'inventory'`.
- **Not a scope config field**: “budget category required on create”. In current web parity it is required in both contexts:
  - Observed in `src/pages/AddTransaction.tsx` (validation: “Budget category is required”)
  - Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (validation: “Budget category is required”)
  - Therefore it belongs in the shared Transactions contract, not as an inventory-only config toggle.

Parity evidence (web):

- `capabilities.canExportCsv: false`: inventory list does not provide CSV export (contrast: project list does). Project export observed in `src/pages/TransactionsList.tsx` (`Export` button + `handleExportCsv`).
- `capabilities.supportsInventoryOnlyStatusFilter: true`: Observed in `src/pages/BusinessInventory.tsx`:
  - `BUSINESS_TX_STATUS_FILTER_MODES` includes `inventory-only`
  - filter implementation uses `projectId === null` for “inventory-only”

## Inventory-scope list controls (parity)

### Search
- State key (web parity): `bizTxSearch`.
- Mobile (Expo Router): persist via list state store keyed by `listStateKey = 'inventory:transactions'` (see `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md` → “List state + scroll restoration”).

Parity evidence:
- Observed in `src/pages/BusinessInventory.tsx` (`transactionSearchQuery`, URL persistence).

### Filters
Inventory scope supports a multi-view filter menu with these views/state keys:
- Status (`bizTxFilter`): `all`, `pending`, `completed`, `canceled`, `inventory-only`
- Reimbursement status (`bizTxReimbursement`): `all`, `we-owe`, `client-owes`
- Receipt emailed (`bizTxReceipt`): `all`, `yes`, `no` (also accepts legacy `no-email` as `no`)
- Transaction type (`bizTxType`): `all`, `purchase`, `return`
- Budget category (`bizTxCategory`): `all` or category id
- Completeness (`bizTxCompleteness`): `all`, `needs-review`, `complete`
- Source (`bizTxSource`): `all` or vendor/source token

Parity evidence:
- Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_TX_*` constants + parse helpers, including `no-email` mapping).

### Sort
Inventory scope supports:
- `bizTxSort`: `date-desc`, `date-asc`, `created-desc`, `created-asc`

Parity evidence:
- Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_TX_SORT_MODES`).

## Inventory-scope create/edit (parity deltas)

### Inventory transactions are not project-scoped
- Created inventory transactions must have `projectId = null` (and `projectName = null` in web model).

Parity evidence:
- Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (forces `projectId = null`, `projectName = null`).

### Budget category required
- Inventory transaction creation requires a budget category.

Parity evidence:
- Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (validation: category required).

### Receipts/media are offline-aware
- Receipt attachments can be queued offline and represented as placeholders until upload completes.

Parity evidence:
- Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (`OfflineAwareImageService.uploadReceiptAttachment`, `offline://` placeholder metadata, `useOfflineMediaTracker`).

## Offline-first notes (mobile target)
- Inventory transactions follow the same local-first + outbox semantics as project transactions, but scoped to inventory collections.
- Media behavior must follow:
  - `40_features/_cross_cutting/offline_media_lifecycle.md`
  - `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Scroll restoration (required; mobile target)

- When navigating from the inventory transactions list to transaction detail, record a restore hint for `listStateKey = 'inventory:transactions'`:
  - preferred: `anchorId = <opened transactionId>`
  - optional fallback: `scrollOffset`
- When returning to the list, restore scroll best-effort (anchor-first) and preserve filters/sort/search.

## Parity evidence index (web)
- Inventory transactions list (filters/sorts/search, navigation to detail): `src/pages/BusinessInventory.tsx`
- Inventory transaction create/edit (category required, projectId null, offline-aware receipts): `src/pages/AddBusinessInventoryTransaction.tsx`, `src/pages/EditBusinessInventoryTransaction.tsx`
- Transaction detail (shared): `src/pages/TransactionDetail.tsx`

