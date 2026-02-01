# Project Transactions — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

Shared-module requirement:

- The Transactions list/detail/actions/form components must be implemented as a **shared Transactions module** reused across Project + Business Inventory scopes (scope-driven configuration; no duplicated implementations).
- Source of truth: `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Transactions list
- [ ] **Renders project transactions list**: shows title, amount, payment method, date, notes preview, and badges.  
  Observed in `src/pages/TransactionsList.tsx` (list item markup + `formatCurrency`, `formatDate`).
- [ ] **Canonical title mapping**: canonical transaction IDs display special titles (inventory purchase/sale).  
  Observed in `src/pages/TransactionsList.tsx` (`getCanonicalTransactionTitle`).
- [ ] **Canonical rows are uncategorized (new model)**: canonical inventory transactions (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`) must not require a user-facing category selection and should be treated as uncategorized on the transaction row (recommended: `category_id = null`).  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md` and `40_features/project-items/feature_spec.md`.  
  **Intentional delta** vs current web: web may assign default category fields on canonical rows (`src/services/inventoryService.ts`).
- [ ] **Sort modes**: supports sorting by purchase date, created date, source, amount, plus stable tie-breaker to avoid jitter.  
  Observed in `src/pages/TransactionsList.tsx` (`TRANSACTION_SORT_MODES`, `sortTransactionsByMode`).
- [ ] **Search behavior**: search matches title/source/type/notes and amount-ish numeric strings.  
  Observed in `src/pages/TransactionsList.tsx` (search filter block with `numericQuery`).
- [ ] **Filters**: filter submenus include at least: transaction type, completeness (needs review vs complete), email receipt, purchased by, budget category, source, reimbursement.  
  Observed in `src/pages/TransactionsList.tsx` (`filterMenuView` union + filter UI).
- [ ] **Budget category filter includes canonical rows via items (new model)**:  
  - Non-canonical transactions match by `transaction.category_id === selectedCategoryId`.  
  - Canonical inventory transactions match if the transaction has **any linked item** with `item.inheritedBudgetCategoryId === selectedCategoryId`.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.
- [ ] **Filter state persistence**: list search/filter/sort state is persisted and restored when navigating away and back.  
  Web parity evidence: `src/pages/TransactionsList.tsx` (URL params `txSearch`, `txFilter`, `txSource`, `txReceipt`, `txType`, `txPurchaseMethod`, `txCategory`, `txCompleteness`, `txSort` + `isSyncingFromUrlRef`).  
  Mobile requirement (Expo Router): persisted via `ListStateStore[listStateKey]` in the shared Transactions list module.
- [ ] **Scroll restoration (anchor-first)**: navigating into a transaction and back restores list scroll position best-effort, preferably by scrolling back to the opened transaction row (`anchorId = transactionId`).  
  Web parity evidence: `src/pages/TransactionsList.tsx` (restore via `restoreScrollY`).  
  Mobile requirement (Expo Router): restore by `anchorId` first, with optional scroll-offset fallback, and clear restore hint after first attempt.
- [ ] **Empty state messaging**: empty state differentiates between “no transactions” and “no results due to filters/search”.  
  Observed in `src/pages/TransactionsList.tsx` (empty state copy based on active filters/search).
- [ ] **Completeness indicator**: list shows “Needs Review” badge when `needsReview===true`, otherwise may show “Missing Items” based on completeness fetch.  
  Observed in `src/pages/TransactionsList.tsx` (`needsReview` badge; `getTransactionCompleteness` usage + `completenessById`).
- [ ] **Canonical total computation**: list computes canonical totals and displays computed value when available.  
  Observed in `src/pages/TransactionsList.tsx` (`computedTotalByTxId`, `computeCanonicalTransactionTotal`).
- [ ] **Canonical total self-heal**: when computed canonical total differs from stored amount, the system attempts to update the stored amount.  
  Observed in `src/pages/TransactionsList.tsx` (`transactionService.updateTransaction` in “Self-healed canonical transaction amount” path).

## Add menu (create + import entrypoints)
- [ ] **Add menu exists**: “Add” menu includes “Create Manually” and “Import Invoice” submenu (Wayfair/Amazon).  
  Observed in `src/pages/TransactionsList.tsx` (Add menu + routes `projectTransactionNew`, `projectTransactionImport`, `projectTransactionImportAmazon`).
- [ ] **Import routes wired**: Invoice import routes are reachable from the transactions context.  
  Observed in `src/pages/TransactionsList.tsx` (ContextLink to import routes).  
  Note: parser behavior is owned by `invoice-import` feature.

## CSV export
- [ ] **Export action exists**: list can export transactions to CSV with project-scoped filename and includes category name + categoryId.  
  Observed in `src/pages/TransactionsList.tsx` (`buildTransactionsCsv`, `fileName = project-<id>-<date>.csv`).  
- [ ] **Canonical rows export without a user-facing category (new model)**: canonical inventory transactions export with `categoryId` blank and category name blank/“Uncategorized” (consistent choice).  
  Optional (recommended): include an extra column that summarizes derived item categories (e.g., `attributedCategoryIds`) based on linked items’ `inheritedBudgetCategoryId`.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`.
- [ ] **Mobile export uses share sheet**: export is shareable via native share UX rather than browser download link creation.  
  **Intentional delta** (platform difference).
- [ ] **Export works offline**: export is generated from local DB (no network required).  
  **Intentional delta** (required by local-first invariant in `40_features/sync_engine_spec.plan.md`).

## Create transaction (manual)
- [ ] **Permission gating**: if user lacks account context and is not system owner, show Access Denied.  
  Observed in `src/pages/AddTransaction.tsx` (guard `!currentAccountId && !isOwner()`).
- [ ] **Default transaction date**: defaults to today (YYYY-MM-DD).  
  Observed in `src/pages/AddTransaction.tsx` (initial `transactionDate` state).
- [ ] **Default category behavior**: attempts to load account default category online; falls back to cached default category offline.  
  Observed in `src/pages/AddTransaction.tsx` (`getDefaultCategory`, `getCachedDefaultCategory`).
- [ ] **Offline prerequisites gate**: submission is blocked unless metadata caches are ready; banner is shown.  
  Observed in `src/pages/AddTransaction.tsx` (`useOfflinePrerequisiteGate`, `OfflinePrerequisiteBanner`, `submitDisabled = ... || !metadataReady`).
- [ ] **Validation**: required fields include source, categoryId, amount (>0).  
  Observed in `src/pages/AddTransaction.tsx` (`validateForm`).
- [ ] **Tax presets**: supports “No Tax”, presets, and “Other” (requires subtotal; subtotal cannot exceed total).  
  Observed in `src/pages/AddTransaction.tsx` (`NO_TAX_PRESET_ID`, `taxRatePreset === 'Other'` validation).
- [ ] **Vendor source selection**: source selection offers vendor defaults plus “Other” custom source input.  
  Observed in `src/pages/AddTransaction.tsx` (`availableVendors`, `isCustomSource`).
- [ ] **Receipts upload**: can attach up to 5 receipts; accepted types include images + PDF; offline placeholder URLs are permitted.  
  Observed in `src/pages/AddTransaction.tsx` (`ImageUpload acceptedTypes`, `OfflineAwareImageService.uploadReceiptAttachment`).
- [ ] **Other images upload**: can attach up to 5 other images; offline placeholders are permitted.  
  Observed in `src/pages/AddTransaction.tsx` (`ImageUpload maxImages`, `OfflineAwareImageService.uploadOtherAttachment`).
- [ ] **Itemization conditional**: itemization list renders only when enabled for the selected category.  
  Observed in `src/pages/AddTransaction.tsx` (`getItemizationEnabled`).

## Edit transaction
- [ ] **Permission gating**: user must have role USER or higher to edit.  
  Observed in `src/pages/EditTransaction.tsx` (`hasRole(UserRole.USER)` guard).
- [ ] **Canonical transactions are not editable (recommended)**: editing is disabled/hidden for canonical inventory transactions (`INV_PURCHASE_*`, `INV_SALE_*`, `INV_TRANSFER_*`) to prevent introducing a user-facing “canonical category” concept and to preserve system-owned mechanics.  
  **Intentional delta** vs current web: the web UI exposes Edit for all transactions (`src/components/transactions/TransactionActionsMenu.tsx`).
- [ ] **Hydration behavior**: attempts to hydrate from cache first, then fetch latest transaction for attachments correctness.  
  Observed in `src/pages/EditTransaction.tsx` (`hydrateTransactionCache`, “Always fetch the latest transaction so attachments stay in sync”).
- [ ] **Back navigation**: returnTo param and/or navigation stack back restores scroll where applicable.  
  Web parity evidence: `src/pages/EditTransaction.tsx` (`getReturnToFromLocation`, `navigationStack.pop`, `restoreScrollY`).  
  Mobile requirement (Expo Router): use native back stack; list restoration is handled by the originating list via `ListStateStore[listStateKey]` (anchor-first).
- [ ] **Existing image preview**: shows existing receipts and other images with remove controls and maxImages=5.  
  Observed in `src/pages/EditTransaction.tsx` (`TransactionImagePreview` usage).
- [ ] **Status ↔ reimbursement rule**: status and reimbursement type are coupled as described in feature spec.  
  Observed in `src/pages/EditTransaction.tsx` (`handleInputChange` rule block).
- [ ] **Itemization behavior**: if itemization disabled but transaction already has items, items are still visible/manageable and a warning is shown.  
  Observed in `src/pages/EditTransaction.tsx` (warning block when `!itemizationEnabled && hasExistingItems`).

## Transaction detail
- [ ] **Core field display**: shows category, source, amount (computed canonical total when applicable), date, payment method, status, reimbursement type, receipt emailed, notes.  
  Observed in `src/pages/TransactionDetail.tsx` (details grid + computed total display).
- [ ] **Receipt section**: displays receipts with add/remove, maxImages=5; add supports images + PDFs.  
  Observed in `src/pages/TransactionDetail.tsx` (Receipts section + `input.accept = 'image/*,application/pdf'` + `TransactionImagePreview maxImages={5}`).
- [ ] **Other images section conditional**: “Other Images” section is only shown when there are other images.  
  Observed in `src/pages/TransactionDetail.tsx` (conditional render `transaction.otherImages?.length > 0`).
- [ ] **Offline placeholder behavior for uploads**: uploading images can create `offline://` placeholders; UI updates immediately; remote update is queued when offline/has placeholders.  
  Observed in `src/pages/TransactionDetail.tsx` (`handleReceiptsUpload`/`handleOtherImagesUpload`, `offlineTransactionService.updateTransaction`, `offlineStore.saveTransactions`).
- [ ] **Offline placeholder deletion**: deleting an `offline://` image deletes the local media blob file.  
  Observed in `src/pages/TransactionDetail.tsx` (`offlineMediaService.deleteMediaFile` in delete handlers).
- [ ] **Gallery integration**: clicking an image tile opens gallery; Esc resets zoom before close.  
  Observed in `src/pages/TransactionDetail.tsx` (gallery open via `handleImageClick`) and `src/components/ui/ImageGallery.tsx` (`Escape` logic).
- [ ] **Transaction items section**: renders itemization list when enabled OR if existing items exist; shows warning if disabled but items exist.  
  Observed in `src/pages/TransactionDetail.tsx` (itemization-enabled block + warning).
- [ ] **Transaction items operations**: supports adding existing items, creating items, updating items, duplicating, deleting, removing from transaction, and bulk/location actions.  
  Observed in `src/pages/TransactionDetail.tsx` (passes handlers into `TransactionItemsList`) and `src/components/TransactionItemsList.tsx` (feature surface).
- [ ] **Item linking sets `inheritedBudgetCategoryId` (new model)**: when an item is linked/assigned to a **non-canonical** transaction with non-null `category_id`, the item is updated to: `item.inheritedBudgetCategoryId = transaction.category_id`. Linking/unlinking to a **canonical** `INV_*` transaction must not overwrite this field.  
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md` and `40_features/project-items/feature_spec.md`.
- [ ] **Actions menu**: supports Edit, Move (project/business inventory), Delete; move is disabled for canonical sale/purchase transactions.  
  Observed in `src/components/transactions/TransactionActionsMenu.tsx` (canonical check + disabled reason).
- [ ] **Delete transaction**: delete requires explicit confirmation and shows error on failure.  
  Observed in `src/pages/TransactionDetail.tsx` (`window.confirm`, `transactionService.deleteTransaction`, toast error).

## Collaboration (Firebase target)
- [ ] **No large listeners**: mobile app does not attach listeners to large collections (transactions/items).  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
- [ ] **Change-signal + delta**: while a project is foregrounded, the app listens only to `meta/sync` and runs delta sync on bump.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
