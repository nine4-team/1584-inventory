# Offline Transaction Image Parity Plan

## Why This Doc Exists
Transaction flows (`TransactionDetail`, `AddTransaction`, and `TransactionItemsList`) still depend on `ImageUploadService` directly. When the user goes offline the upload promises fail immediately, no placeholder metadata is stored, and nothing gets queued for later sync. We need a clear path to make every transaction image operation behave like `AddItem`/`ItemDetail`, where uploads seamlessly degrade to offline queues and clean themselves up if the UI exits early.

## Scope
- Item image uploads initiated from the transaction detail screen (adding/updating items inline).
- Receipt image / PDF attachments.
- "Other" transaction attachments.
- Item image uploads while building a transaction on `AddTransaction` (via `TransactionItemsList` + `ImageUpload`).
- Image deletions and cancellation flows for all of the above.

## Current Gaps (as of Jan 2026)
| Area | File/Function | Problem |
| --- | --- | --- |
| Inline item uploads | `TransactionDetail.uploadItemImages` | Uses `ImageUploadService.uploadItemImage`. No offline placeholder URLs or metadata are written, so offline uploads fail silently. |
| Receipt attachments | `handleReceiptsUpload` in `TransactionDetail.tsx` | Calls `ImageUploadService.uploadMultipleReceiptAttachments`. No queueing or metadata storage. |
| Other attachments | `handleOtherImagesUpload` | Same issue as receipts. |
| Add Transaction item uploads | `TransactionItemsList` + `ImageUpload` component under `AddTransaction.tsx` | `ImageUpload` already speaks OfflineAwareImageService, but the enclosing flow never hydrates metadata into the transaction item payload, so queued images never reach the saved item. |
| Deletions for attachments | `handleDeleteReceiptImage` / `handleDeleteOtherImage` | Deletes Supabase rows only. If an attachment was queued offline there is no cleanup call to `offlineMediaService`, leaving orphaned files. |
| Cancellation / unmount | `TransactionDetail` & `AddTransaction` | No `offlineMediaIdsRef` tracking nor cleanup on unmount, so abandoning the screen after selecting images leaves queued blobs with no references. |

## Goals
1. **Parity with Add Item / Item Detail** for every transaction image action: upload offline, hydrate metadata, and clean up on unmount/cancel.
2. **Single source of truth for queued media** so that subsequent item/transaction saves automatically reference the offline media IDs.
3. **Consistent UX messaging** (toasts, banners) whenever uploads are queued vs completed immediately.

## Implementation Plan

### 1. Inline Item Image Uploads (`TransactionDetail`)
_Status: ✅ completed Jan 2026 (mirrors `ItemDetail` offline flow)._
1. Replace the `Promise.all` / `ImageUploadService.uploadItemImage` block inside `uploadItemImages` with a sequential loop that calls `OfflineAwareImageService.uploadItemImage`.
2. Mirror the `ItemDetail` implementation:
   - Track metadata `{ offlineMediaId, isOfflinePlaceholder }`.
   - Push each ID into `offlineMediaIdsRef`.
   - After `unifiedItemsService.updateItem` succeeds, remove those IDs from the ref.
3. Add `offlineMediaIdsRef` + `useEffect` cleanup to delete leftover queued files if the component unmounts.
4. On deletion (`handleRemoveImage` equivalent for transaction items) detect `offline://` URLs, delete via `offlineMediaService`, and prune tracking refs.

### 2. Receipt & Other Attachments
_Status: ⏳ partially complete. Offline-aware uploads and cleanup exist, but metadata persistence + offline transaction queue still pending (see Section 6)._
1. Create helper wrappers `uploadReceiptAttachmentsOfflineAware` and `uploadOtherAttachmentsOfflineAware` that:
   - Iterate files sequentially.
   - Use `OfflineAwareImageService.uploadItemImage` (or build specialized helpers in `offlineAwareImageService` for transaction-level storage buckets if needed).
   - Tag metadata so the transaction update payload knows which ones are placeholders.
2. Track queued media IDs per attachment type (`receiptOfflineMediaIdsRef`, `otherOfflineMediaIdsRef`).
3. Update `handleReceiptsUpload` / `handleOtherImagesUpload` to:
   - Include metadata in the `TransactionImage` objects (`metadata.offlineMediaId`, `isOfflinePlaceholder`).
   - Persist the attachments immediately to `transactionService.updateTransaction`.
   - Remove IDs from tracking refs after a successful write.
4. Enhance deletion handlers to:
   - Detect offline placeholders, delete them via `offlineMediaService`, and drop from the ref before updating the transaction record.
5. Add unmount cleanup effects for both refs so abandoned screens don’t leak files.

### 3. Add Transaction Flow (`AddTransaction.tsx` + `TransactionItemsList`)
_Status: ⏳ partially complete. Item uploads now use OfflineAwareImageService + tracker, but placeholders still need to be persisted locally when offline (blocked on Section 6)._
1. Audit how `ImageUpload` provides image data back to `TransactionItemsList`. Ensure item-level `images` in form state can store `{ url, metadata }`.
2. When the user adds a new transaction item offline:
   - Persist the placeholder metadata in the optimistic item stored inside `TransactionItemsList`.
   - When `AddTransaction` eventually saves, include those images (with offline URLs) in the body that goes to `unifiedItemsService.createItem`.
3. Track offline media IDs at the form level so abandoning the Add Transaction screen purges queued blobs. Follow the same `offlineMediaIdsRef` + cleanup pattern.

### 4. Shared Utilities
_Status: ✅ completed Jan 2026 (`useOfflineMediaTracker`, extended `OfflineAwareImageService`)._
1. Consider extracting a small hook (`useOfflineMediaTracker`) that encapsulates the ref + add/remove + cleanup behavior. Both `ItemDetail` and transaction flows could reuse it.
2. Extend `OfflineAwareImageService` with helpers for:
   - Receipt uploads (possibly different storage buckets/paths).
   - Generic attachment uploads when no itemId exists yet (allow passing a temp ID and re-writing once the transaction is saved).
3. Ensure `offlineMediaService.deleteMediaFile` gracefully handles duplicates, since multiple screens may attempt to delete the same ID during cleanup.

### 5. UX & Messaging
_Status: ✅ completed Jan 2026 (shared offline toast + placeholder badges wired up in current UI)._
1. Surface the same offline banners/toasts used in Add Item (`useOfflineFeedback`, `showOfflineSaved`) whenever uploads fall back to queueing.
2. Update the receipt / other image sections to display placeholders (e.g., show “Sync pending” badges when `metadata.isOfflinePlaceholder` is true).

### 6. Data & Sync Requirements (New)
To unlock true offline parity for transaction-level attachments we need two foundational pieces:
1. **Metadata persistence:** add a JSONB `metadata` column (or extend the serialized JSON payload) for `transactionImages`, `receiptImages`, and `otherImages`. It must store `{ offlineMediaId?: string; isOfflinePlaceholder?: boolean }` so placeholders survive refreshes and the sync job knows which queued media to process.
2. **Queued transaction mutations:** when offline, receipt/other uploads must skip `transactionService.updateTransaction` and instead enqueue a transaction update intent (e.g., `{ transactionId, attachmentType, attachments[] }`) alongside the offline media entry. The sync worker will:
   - Upload each queued `offlineMediaId` once online.
   - Swap the URLs in the attachment payload.
   - Execute the deferred `updateTransaction` call.
   - Delete the offline media + queue entry.

Until both items ship, receipts/other attachments still fail if the transaction write happens offline and placeholder metadata is lost once state resets.

## Testing Checklist
- [ ] Go offline, add images to a transaction item, and confirm they appear with placeholder metadata, survive navigation, and sync when back online.
- [ ] Go offline, upload receipts/other attachments, refresh after reconnecting, ensure they sync and the queued files are cleared.
- [ ] Delete offline placeholders before reconnecting; confirm queued files are removed and nothing uploads later.
- [ ] Abandon the screen during uploads; verify `offlineMediaService` cleanup runs (no stray entries in IndexedDB/queue).

## Implementation Gaps Identified (Jan 2026 QA pass)
- **Receipt/other uploads never sync when offline.** `TransactionDetail` now skips `transactionService.updateTransaction` whenever placeholders exist and just mutates IndexedDB. No offline operation is queued, so queued attachments never reach Supabase once back online.
- **Offline media files for Add Transaction are wiped before sync.** The form tracks `receiptOfflineMediaIds` / `otherOfflineMediaIds` but never removes them from the tracker, so `useOfflineMediaTracker` deletes the blobs on unmount and the sync worker has nothing to upload.
- **CREATE_TRANSACTION operations ignore attachments.** `executeCreateTransaction` still inserts rows without `transaction_images`, `receipt_images`, or `other_images`, so any placeholders captured during offline creation are discarded the moment the queue syncs.
- **Placeholder processing cannot upload blobs.** `processOfflinePlaceholders` calls `ImageUploadService.uploadReceiptAttachment(mediaFile.file, …)` but `offlineMediaService.getMediaFile` only returns `{ blob, filename, mimeType }`. The upload helper never receives a real `File`, so every attempt throws and the placeholders remain forever.
- **Storage path parity risks.** The sync helper fabricates a `Project-${transaction.projectId}` folder, so even if uploads succeeded they would land in non-standard paths that our storage cleanup jobs do not monitor.

## Tracking
- Owner: Offline task force
- Target milestone: “Offline Transaction UI Stability”
- Related docs: `OFFLINE_TRANSACTION_UI_STABILITY.md`, `OFFLINE_SYSTEM_NORMALIZATION.md`
