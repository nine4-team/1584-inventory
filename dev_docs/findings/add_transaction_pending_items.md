# Add Transaction -> Pending Item Investigation (Jan 2026)

Context: reproduces the report that adding items inside `AddTransaction` (before the transaction exists server-side) now ships with a broken inline experience--draft items lose their default disposition and their thumbnails render as broken images. Below are the verified findings for both the online and offline paths, with callouts to the exact code that is driving each regression.

---

## Findings at a Glance

1. **Draft items have no disposition.** `TransactionItemForm` never seeds `disposition: 'purchased'`, so every optimistic item created inside `AddTransaction` has `disposition === undefined`. Online saves eventually coerce the DB record back to `purchased`, but the inline UI (and every offline record) stays blank.
2. **Draft thumbnails point at fake URLs.** The form generates preview metadata such as `preview_<fileName>`, but it never turns the selected `File` into a blob URL via `ImageUploadService.createPreviewUrl`. Both `ImagePreview` (inside the modal) and `ItemPreviewCard` (list view) try to render those fake URLs and fall back to the broken-image icon.
3. **Offline sync keeps the disposition blank forever.** When we queue a transaction offline, `offlineItemService.createItem` copies the optimistic item as-is (still missing a disposition). Later, `operationQueue.executeCreateItem` inserts the null value into Supabase, so even after sync, those items do not default to `purchased`.

---

## 1. Draft items never receive the "Purchased" disposition

- `TransactionItemForm` builds the optimistic payload solely from visible fields and never touches `disposition`:  

```32:43:src/components/TransactionItemForm.tsx
const buildFormData = (source?: TransactionItemFormData): TransactionItemFormData => ({
  id: source?.id || stableTempId,
  description: source?.description ?? '',
  sku: source?.sku ?? '',
  purchasePrice: source?.purchasePrice ?? '',
  projectPrice: source?.projectPrice ?? '',
  marketValue: source?.marketValue ?? '',
  space: source?.space ?? '',
  notes: source?.notes ?? '',
  taxAmountPurchasePrice: source?.taxAmountPurchasePrice ?? '',
  taxAmountProjectPrice: source?.taxAmountProjectPrice ?? ''
})
```

- There is no fallback elsewhere in the form (`rg "disposition" TransactionItemForm.tsx` returns no matches), so the `items` array inside `AddTransaction` is full of objects lacking a disposition. `TransactionItemsList` feeds that directly into `ItemPreviewCard`, which hides the badge entirely because there is no status to display.  
- Online path: when `transactionService.createTransaction` finally calls `unifiedItemsService.createTransactionItems`, the server insert sets `disposition: 'purchased'` regardless of the form value, so the persisted items recover (`5152:src/services/inventoryService.ts`).  
- Offline path: the queued transaction routes each child item through `offlineItemService.createItem`, which simply forwards `itemData.disposition`. Since it is still `undefined`, the offline DB cache and the later Supabase insert stay null (`191:src/services/offlineTransactionService.ts` -> `680:src/services/operationQueue.ts`).

**Impact.**

- Inline UX: users never see the "Purchased" badges while they are composing the transaction, which is what prompted the original complaint.
- Offline parity: any transaction created offline syncs with null dispositions, so even after coming back online, those items show as "Not set" everywhere.

**Low-effort fix (for later implementation).**

Default the form data to `disposition: 'purchased'` (and ideally surface a read-only badge so the user sees that status before saving). For offline correctness we also need `offlineItemService.createItem` or the queuing layer to coerce the value to `purchased` before inserting.

---

## 2. Thumbnail URLs are not real object URLs

- When selecting images inside the transaction item form we build faux preview metadata instead of a usable URL:  

```82:99:src/components/TransactionItemForm.tsx
const previewImages: ItemImage[] = newFiles.map((file, index) => ({
  url: `preview_${file.name}_${file.size}_${Date.now()}_${index}`, // not an object URL
  alt: file.name,
  isPrimary: itemImages.length === 0 && index === 0,
  uploadedAt: new Date(),
  fileName: file.name,
  size: file.size,
  mimeType: file.type
}))
setItemImages(prev => [...prev, ...previewImages])
```

- `ImagePreview` (used right inside the modal) eventually does `src={resolvedUrls[image.url] || image.url}` (`186:src/components/ui/ImagePreview.tsx`). Because the string is neither an HTTP URL nor an `offline://` placeholder, the `<img>` tag fails and the user gets the broken-image icon plus the filename overlay.
- After saving the item, `TransactionItemsList` passes the same `item.images` array into `ItemPreviewCard`, which repeats the exact logic: the invalid URL path produces the same broken thumbnail in the list view.
- Compare this with the generic `ImageUpload` component, which calls `ImageUploadService.createPreviewUrl(file)` to generate an object URL before setting preview state (`117:147:src/components/ui/ImageUpload.tsx`).

**Impact.**

- Users cannot verify the photo they just attached until after the transaction successfully saves, because every draft thumbnail is broken both inside the modal and in the summary list.
- The regression also affects offline workflows: even though the actual `File` objects are stored in `imageFilesMap` for later upload, there is zero visual confirmation until sync finishes.

**Low-effort fix (for later implementation).**

- Call `ImageUploadService.createPreviewUrl(file)` when building `previewImages`, store that URL (and revoke it on removal) so `ImagePreview` and `ItemPreviewCard` receive a real blob URL.
- Alternatively, change `ImagePreview`/`ItemPreviewCard` to detect `image.imageFile` or `item.imageFiles` and derive previews on the fly--but the current data model only exposes `ItemImage.url`, so generating a proper preview when we first select the file is the least invasive option.

---

## 3. Offline transactions sync back with null dispositions

- `offlineTransactionService.createTransaction` loops through each optimistic item and hands it to `offlineItemService.createItem` with whatever `disposition` the form supplied (`191-205:src/services/offlineTransactionService.ts`). Because the form never set one, every cached item has `disposition = undefined`.
- When connectivity returns, `operationQueue.executeCreateItem` replays the cached item and inserts `disposition: localItem.disposition ?? null` (`680:721:src/services/operationQueue.ts`). There is no secondary default, so the server copy stays null.
- Contrast with the online path in `unifiedItemsService.createTransactionItems` where `disposition: 'purchased'` is hard-coded (`5152:src/services/inventoryService.ts`). That difference explains why the behavior only regressed once offline queuing became the dominant path.

**Impact.**

- Any transaction created while offline permanently produces items without a disposition, so downstream tooling (audits, filters, duplicate grouping) behaves as if the user never marked the purchase as complete.
- Because the optimistic UI also shows blank states (see Finding 1), this bug is invisible until someone inspects the data later--hence the user report that "disposition is not getting set to purchased automatically."

**Suggested remediation path.**

1. Give `TransactionItemForm` a default and include `disposition` in `itemWithImages`.
2. When queuing offline, override missing dispositions to `'purchased'` before calling `offlineItemService.createItem`.
3. As a safety net, add a default inside `operationQueue.executeCreateItem` before inserting into Supabase.

---

## Additional Notes

- The existing `ImageUpload` and `ImagePreview` plumbing is already fully offline-aware (`offlineMediaService`, `useOfflineMediaTracker`), so once we feed it a real blob URL, both online and offline thumbnails will render correctly without additional queue changes.
- The same `transactionService` handler already tracks `imageFilesMap` and uploads each `File` through `OfflineAwareImageService.uploadItemImage` after the transaction is saved (`437-533:src/pages/AddTransaction.tsx`). No changes are needed to the post-save upload pipeline; the regression is purely in the optimistic rendering.
- I have not touched any code per the request; this document is intended to guide the eventual fix.

---

## Next Steps (when ready to implement)

1. Update `TransactionItemForm` to seed and persist `disposition: 'purchased'`, and ensure offline queues inherit that value.
2. Swap the faux preview URL with `ImageUploadService.createPreviewUrl` (and revoke URLs on cleanup) so draft thumbnails display.
3. Add a defensive default inside `operationQueue.executeCreateItem` to cover any legacy offline entries that still lack a disposition.

Let me know if you'd like me to implement the fixes or dig into the offline attachment TODOs next.
