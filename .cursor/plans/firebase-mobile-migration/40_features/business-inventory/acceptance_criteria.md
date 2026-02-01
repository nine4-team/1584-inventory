# Business inventory — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Business inventory home (tabs + refresh + state restoration)
- [ ] **Default tab**: Business inventory defaults to the Items tab (`inventory`) when `bizTab` is not set.  
  Observed in `src/pages/BusinessInventory.tsx` (`DEFAULT_BUSINESS_TAB`, `activeTab` init).
- [ ] **Transactions tab selection**: When `bizTab=transactions`, the Transactions tab is active.  
  Observed in `src/pages/BusinessInventory.tsx` (`activeTab` init + URL sync).
- [ ] **List state persistence (mobile)**: Item and transaction list controls persist with debounce via `ListStateStore[listStateKey]`.  
  Web parity evidence: `src/pages/BusinessInventory.tsx` (debounced `setSearchParams` updater, 500ms).
- [ ] **Refresh control**: Business inventory provides a manual refresh that forces a snapshot reload and handles errors.  
  Observed in `src/pages/BusinessInventory.tsx` (`handleRefreshInventory`, `refreshCollections({ force: true })`, toast error).
- [ ] **Scroll restoration (anchor-first; mobile)**: Navigating into item/transaction detail from a long list and back restores scroll position best-effort, preferably by scrolling back to the tapped row (`anchorId`).  
  Web parity evidence: `src/pages/BusinessInventory.tsx` (passes `scrollY` during navigate) + list restore via `restoreScrollY` pattern (see `src/pages/InventoryList.tsx`, `src/pages/TransactionsList.tsx`).

## Inventory items list (filters/sorts/grouping/bulk)
- [ ] **Search**: Inventory items support search via `bizItemSearch` and apply it consistently across list and next/previous navigation.  
  Observed in `src/pages/BusinessInventory.tsx` (`inventorySearchQuery`) and `src/pages/BusinessInventoryItemDetail.tsx` (`bizItemSearch` parsing + filtering).
- [ ] **Filter modes**: Inventory items filter supports: `all`, `bookmarked`, `no-sku`, `no-description`, `no-project-price`, `no-image`, `no-transaction`.  
  Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_ITEM_FILTER_MODES`) and `src/pages/BusinessInventoryItemDetail.tsx` (valid modes list).
- [ ] **Sort modes**: Inventory items sort supports `alphabetical` and `creationDate` (newest first).  
  Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_ITEM_SORT_MODES`) and `src/pages/BusinessInventoryItemDetail.tsx` (creation-date sort uses newest-first).
- [ ] **Bulk selection**: Users can select items and run bulk actions against the selection; selection is cleared after completion.  
  Observed in `src/pages/BusinessInventory.tsx` (`selectedItems` and bulk action handlers; clears selection after allocation/delete).
- [ ] **Batch allocation**: Users can allocate selected items to a project and optionally provide a space.  
  Observed in `src/pages/BusinessInventory.tsx` (`batchAllocateItemsToProject`, modal with `projectId` + `space`).
- [ ] **Per-item allocation**: Users can allocate a single inventory item to a project from item detail.  
  Observed in `src/pages/BusinessInventoryItemDetail.tsx` (`allocateItemToProject`, allocation modal).
- [ ] **Allocation offline feedback**: When allocating while offline, show “saved offline” feedback and avoid blocking on realtime refresh.  
  Observed in `src/pages/BusinessInventoryItemDetail.tsx` (checks `isOnline`, calls `showOfflineSaved`, returns early).
- [ ] **Duplicate grouping**: Inventory list groups duplicates and provides a collapsed-group UI.  
  Observed in `src/pages/BusinessInventory.tsx` (`CollapsedDuplicateGroup`, `getInventoryListGroupKey`).
- [ ] **QR generation gating**: “Generate QR codes” is shown only when QR feature flag is enabled.  
  Observed in `src/pages/BusinessInventory.tsx` (`ENABLE_QR` from `VITE_ENABLE_QR`).

## Inventory items create/edit
- [ ] **Permission gate**: Users without the required role cannot add inventory items; they see an Access Denied screen with a back CTA.  
  Observed in `src/pages/AddBusinessInventoryItem.tsx` (`hasRole(UserRole.USER)` guard).
- [ ] **Validation**: Creating an item requires either a description or at least one image.  
  Observed in `src/pages/AddBusinessInventoryItem.tsx` (`validateForm`).
- [ ] **Quantity create loop**: Users can create multiple items via a quantity control; each item is created with the same payload and gets a unique id.  
  Observed in `src/pages/AddBusinessInventoryItem.tsx` (loop around `unifiedItemsService.createItem`).
- [ ] **Save-time price default**: If `projectPrice` is blank, it defaults to `purchasePrice` at save time.  
  Observed in `src/pages/AddBusinessInventoryItem.tsx` (sets `projectPrice: formData.projectPrice || formData.purchasePrice`).
- [ ] **Offline error clarity**: If offline storage is unavailable or the user lacks offline context, show a specific error message.  
  Observed in `src/pages/AddBusinessInventoryItem.tsx` (`OfflineQueueUnavailableError`, `OfflineContextError`).

## Inventory item detail
- [ ] **Next/previous navigation**: Item detail supports next/previous navigation through the *filtered+sorted* list and preserves list state in the URL.  
  Observed in `src/pages/BusinessInventoryItemDetail.tsx` (builds `filteredAndSortedItems`, uses `bizItem*` params, uses `{ replace: true }`).
- [ ] **Bookmark toggle**: Users can add/remove a bookmark from item detail.  
  Observed in `src/pages/BusinessInventoryItemDetail.tsx` (`toggleBookmark`).
- [ ] **Transaction assignment**: Users can assign an item to a transaction, change the transaction, or remove it from a transaction (with confirmation).  
  Observed in `src/pages/BusinessInventoryItemDetail.tsx` (transaction dialog + remove confirm + `unlinkItemFromTransaction`).
- [ ] **Image management**: Users can add images, remove images, and set a primary image from item detail.  
  Observed in `src/pages/BusinessInventoryItemDetail.tsx` (`handleSelectFromGallery`, `handleRemoveImage`, `handleSetPrimaryImage`) and `ImagePreview` usage.

## Inventory transactions list (filters/sorts)
- [ ] **Status filter**: Status filter supports `all`, `pending`, `completed`, `canceled`, and `inventory-only`.  
  Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_TX_STATUS_FILTER_MODES`).
- [ ] **Receipt filter legacy**: A legacy `bizTxReceipt=no-email` value is accepted and treated as “no”.  
  Observed in `src/pages/BusinessInventory.tsx` (`parseBusinessTxReceiptFilterMode` maps `no-email` → `no`).
- [ ] **Budget category filter options**: Budget categories are loaded and used to filter transactions.  
  Observed in `src/pages/BusinessInventory.tsx` (`budgetCategoriesService.getCategories`, transaction filtering against `categoryId`/`budgetCategory`).
- [ ] **Sort modes**: Inventory transactions sort supports `date-desc`, `date-asc`, `created-desc`, `created-asc`.  
  Observed in `src/pages/BusinessInventory.tsx` (`BUSINESS_TX_SORT_MODES`).

## Inventory transactions create/edit (including receipts/media)
- [ ] **Inventory-scope project id**: Inventory transactions are created with `projectId = null`.  
  Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (forces `projectId = null`, `projectName = null`).
- [ ] **Category required**: Budget category is required for inventory transactions create.  
  Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (`if (!formData.categoryId?.trim())`).
- [ ] **Offline-aware receipts**: Receipt attachments can be queued offline and represented with placeholders until upload completes.  
  Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (`OfflineAwareImageService.uploadReceiptAttachment`, `offline://` placeholder metadata).
- [ ] **Offline receipt feedback**: If receipts were queued while offline, show “saved offline” feedback.  
  Observed in `src/pages/AddBusinessInventoryTransaction.tsx` (checks `receiptOfflineMediaIds.length > 0 && !isOnline`, calls `showOfflineSaved()`).

## Firebase mobile collaboration (intentional deltas)
- [ ] **No large listeners**: The mobile app does not attach listeners to large collections (inventory items/transactions).  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
- [ ] **Inventory change-signal listener**: While the inventory workspace is active + foregrounded, the mobile app listens only to `accounts/{accountId}/inventory/meta/sync`.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
- [ ] **Delta sync on signal**: Signal change triggers delta fetches and local DB upserts/deletes for inventory collections.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.

