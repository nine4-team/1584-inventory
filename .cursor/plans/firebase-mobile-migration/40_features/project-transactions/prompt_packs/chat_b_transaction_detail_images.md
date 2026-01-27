## Prompt Pack — Chat B: `TransactionDetail` image sections contract

You are helping migrate Ledger to **React Native + Firebase** with an **offline-first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

### Goal (this chat)

Write the **`TransactionDetail` images section** contract (receipts + other images + pinning + offline placeholders + deletion semantics).

### Outputs (required)

Create/update:
- `40_features/project-transactions/ui/screens/transaction_detail.md` (images-related sections)

This screen contract should link out to:
- `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

### Source-of-truth code pointers (parity evidence)

Use these files as the canonical behavior reference:
- `src/pages/TransactionDetail.tsx`
- `src/components/ui/ImagePreview.tsx` (Transaction image preview tile grid behavior)
- `src/components/ui/ImageGallery.tsx` (lightbox behavior; referenced, not rewritten)
- `src/services/offlineAwareImageService.ts` (offline placeholder uploads)
- `src/services/offlineMediaService.ts` (offline media storage/cleanup)

### What to capture (required)

Document:
- **Sections**
  - Receipt Images section
  - Other Images section (and when it is shown/hidden)
- **Add/upload flows**
  - How user adds images (file picker/camera equivalent)
  - Upload progress indicators (“Uploading receipts/images”)
  - Max image counts per section
  - What happens when offline (placeholder URLs / queued uploads)
- **Image tiles**
  - What happens when a user taps an image tile (opens gallery at correct index)
  - Tile menu options (remove, pin, etc.) and their behavior
- **Delete semantics**
  - Removing a receipt vs removing an “other” image
  - Handling offline placeholders when deleted (cleanup local media ids)
  - Pending/error states on delete
- **Pinning**
  - What “pin” does (pinned image layout, where it renders, how unpin works)
  - Interaction between pinning and gallery (pin from gallery vs pin from tile)
- **Attachment normalization**
  - How attachments are combined and filtered to “renderable images” for the gallery
  - Mime-type edge cases (e.g., PDFs shouldn’t enter the image gallery)
- **States**
  - Empty states (no receipts / no other images)
  - Offline/pending states
  - Error states for upload/delete

### Evidence rule (anti-hallucination)

For each behavior above, add “Observed in …” evidence with file + function/handler name (e.g., `handleReceiptImagesUpload`, `handleDeleteReceiptImage`, `isRenderableImageAttachment`).

### Constraints / non-goals

- No pixel-perfect UI spec; focus on actions → state → effects.
- Collaboration must not rely on large listeners; reference the change-signal + delta approach for propagation expectations where relevant.

