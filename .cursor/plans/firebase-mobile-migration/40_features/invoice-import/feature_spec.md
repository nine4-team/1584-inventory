# Invoice import — Feature spec (Firebase mobile migration)

## Intent
Provide a vendor-PDF import flow that turns an Amazon or Wayfair invoice into a **draft transaction + draft items**, lets the user review/edit the draft, then creates a real transaction and items in an **offline-first** way:

- UI reads/writes local SQLite
- Creates are local-atomic (DB write + outbox enqueue)
- Media (invoice PDF as receipt, Wayfair thumbnails as item images) uses the shared offline media lifecycle
- No large listeners; collaboration convergence is via change-signal + delta sync

## Owned screens / routes
- `ImportWayfairInvoice`
  - Web parity route: `/project/:projectId/transactions/import-wayfair`
  - Web parity source: `src/pages/ImportWayfairInvoice.tsx`
- `ImportAmazonInvoice`
  - Web parity route: `/project/:projectId/transactions/import-amazon`
  - Web parity source: `src/pages/ImportAmazonInvoice.tsx`

Screen contracts:
- `ui/screens/ImportAmazonInvoice.md`
- `ui/screens/ImportWayfairInvoice.md`

## Inputs (entities + dependencies)
This feature composes a transaction and items, and depends on metadata:
- Project (`projects`) — used for display context and for media path labeling
- Transactions (`transactions`) — created
- Items (`items`) — created
- Budget categories (`budget_categories`) — category picker (required by UX)
- Tax presets — Wayfair supports “Other” tax model in the draft (subtotal + tax total relationship)

Media dependencies:
- Receipt attachment: the uploaded invoice PDF becomes a receipt attachment on the created transaction (parity behavior).
- Wayfair embedded thumbnails: extracted images become item images (preview, then uploaded/attached).

Cross-cutting specs (canonical):
- Offline-first invariants + outbox + delta sync: `40_features/sync_engine_spec.plan.md`
- Offline media lifecycle: `40_features/_cross_cutting/offline_media_lifecycle.md`
- Storage/quota guardrails: `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Primary flows

### 1) Open importer from project transactions
Entry point (web parity):
- From Transactions list “Add” menu → “Import invoice” → vendor choice.
- Evidence: `src/pages/TransactionsList.tsx` (see `projectTransactionImportAmazon` / `projectTransactionImport` routes).

Navigation rule (mobile):
- Back behavior uses native back stack; only use `backTarget` fallback for deep links/cold starts.
- Source of truth: `40_features/navigation-stack-and-context-links/README.md`

### 2) Select an invoice PDF and parse locally
Web parity behavior:
- File picker (and drag/drop in web) selects a `application/pdf` file.
- Parse happens locally: extract PDF text and run vendor parser; Wayfair also extracts embedded images.
- Evidence:
  - `src/pages/ImportAmazonInvoice.tsx` (`onFileSelected` → `parsePdf`)
  - `src/pages/ImportWayfairInvoice.tsx` (`onFileSelected` → `parsePdf` with `Promise.all([extractPdfText, extractPdfEmbeddedImages])`)
  - `src/utils/pdfTextExtraction.ts` (`extractPdfText`, line reconstruction by x/y token grouping)
  - `src/utils/pdfEmbeddedImageExtraction.ts` (`extractPdfEmbeddedImages`, render+crop thumbnails)

Required warnings model:
- Parsing produces a `warnings[]` list; warnings do not necessarily block creation (except wrong-vendor detection, see Amazon).
- Evidence:
  - Amazon: `parseAmazonInvoiceText()` returns `warnings` and explicitly returns `['Not an Amazon invoice']` if signature check fails (`src/utils/amazonInvoiceParser.ts`)
  - Wayfair: `parseWayfairInvoiceText()` returns `warnings` (format drift/totals mismatch) (`src/utils/wayfairInvoiceParser.ts`)

Mobile constraint (intentional delta):
- The mobile implementation must support **local parsing** where possible. If a device/platform cannot parse locally, the UI must explicitly require connection and offer an “Upload for parsing” fallback (optional), without breaking offline-first correctness for the created transaction.

### 3) Present parse summary + debug parse report tooling
Parity behaviors:
- Show a parse summary header (invoice/order id, parsed totals, line item count) and show warnings if present.
  - Evidence: parse summary blocks in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx`
- Provide a “Parse report (debug)” disclosure with:
  - Copy JSON to clipboard
  - Download JSON
  - Include extraction stats + first N lines of extracted text
  - Evidence: `buildParseReport`, `copyParseReportToClipboard`, `downloadParseReportJson` in both importer pages
- Provide a “raw extracted text” preview with selectable line limits (200/400/800/1600/all) in the debug disclosure.
  - Evidence: `RAW_TEXT_PREVIEW_OPTIONS` in both importer pages

Mobile adaptation:
- Copy-to-clipboard is supported when available; otherwise “Share debug JSON” via share sheet is acceptable.
- Download as a file becomes “share as JSON”.

### 4) Convert parse result into a draft transaction + draft items

#### Shared draft fields
Default behavior (parity):
- `transactionDate` defaults to today and is overwritten by parsed order date when available.
- `amount` defaults from parsed total; fallback is sum of line item totals.
- `notes` default includes a vendor import marker plus invoice/order metadata.
- Evidence:
  - Amazon: `applyParsedInvoiceToDraft` in `src/pages/ImportAmazonInvoice.tsx`
  - Wayfair: `applyParsedInvoiceToDraft` in `src/pages/ImportWayfairInvoice.tsx`

Draft editing:
- User can edit transaction date, amount, category, payment method, notes.
- User can edit item drafts in an itemization-style editor before creating.
- Evidence:
  - `TransactionItemsList` usage in both importer pages (draft mode via `enablePersistedItemFeatures={false}`)

#### Amazon draft mapping (parity)
- Wrong-vendor hard stop: if warnings include “Not an Amazon invoice”, show an error and prevent create.
  - Evidence: `applyParsedInvoiceToDraft` + create button disabled guard in `src/pages/ImportAmazonInvoice.tsx`
- Item mapping:
  - Quantity expands into distinct items (no grouping).
  - Per-unit purchase price uses line item `unitPrice` when present; else \(total/qty\).
  - Item fields set: `description`, `purchasePrice`, `price`, `notes` (includes “Amazon import” and shipped date when known).
  - Evidence: `buildAmazonItemDrafts` + `expandAmazonItemDrafts` in `src/pages/ImportAmazonInvoice.tsx`

#### Wayfair draft mapping (parity)
- Item mapping:
  - SKU is populated when detected.
  - Per-unit purchase price includes shipping/adjustment heuristics; tax per-unit is captured as `taxAmountPurchasePrice` when available.
  - Notes incorporate shipped status, to-be-shipped marker, and attribute lines (color/size/etc).
  - Evidence: `buildWayfairItemDrafts` in `src/pages/ImportWayfairInvoice.tsx`
- Draft grouping:
  - Items with SKU are grouped by a stable group key (sku + normalized price) for edit UX; items without SKU are ungrouped.
  - Evidence: `expandWayfairItemDrafts` (`uiGroupKey` logic) in `src/pages/ImportWayfairInvoice.tsx`
- Embedded thumbnails:
  - Extract embedded images from PDF and match to line items by row order; show a warning if counts mismatch.
  - Apply first thumbnail as a preview item image and stage the image file for upload.
  - Evidence: `extractPdfEmbeddedImages`, `applyThumbnailsToDrafts`, `createPreviewItemImageFromFile` in `src/pages/ImportWayfairInvoice.tsx`

### 5) Create the transaction + items (offline-first requirement)
Parity behavior (web):
- “Create Transaction” calls `transactionService.createTransaction(accountId, projectId, transactionData, items)` and navigates to the created transaction detail.
- Evidence: `handleCreate` in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx`

Mobile offline-first requirement (intentional delta, required by architecture):
- The create action must be a **single local transaction**:
  - write transaction + items to SQLite
  - enqueue outbox op(s) with stable idempotency keys (e.g., `createTransactionWithItems:<localId>`), so retries never double-create remotely
- If offline or background execution is limited, do not block the user on uploads. Show “created (pending sync)” and allow them to leave the importer immediately.

### 6) Attach media (receipt PDF + item images) and retry semantics
Parity behavior (web):
- After creation, media uploads may run “in the background” and then patch:
  - transaction receipt attachments
  - item images (Wayfair)
- Evidence:
  - Amazon: `finalizeAmazonImportReceipt` (uploads receipt PDF and updates transaction)
  - Wayfair: `finalizeWayfairImportAssets` (uploads item images with concurrency limit + updates items; uploads receipt; warns on failures)

Mobile offline-first requirement:
- Receipt PDF and Wayfair thumbnails must be treated as offline media assets:
  - create local-only placeholders immediately
  - enqueue upload ops in the outbox
  - allow retry from the Transaction detail screen when any upload fails
- Source of truth: `40_features/_cross_cutting/offline_media_lifecycle.md`

## Permissions
Parity behavior:
- If user lacks account context and is not system owner, show “Access Denied” UI with a back CTA.
- Evidence: guard in both importer pages (`if (!currentAccountId && !isOwner())`).

Mobile requirement:
- Map the above to Roles v1 gating (owner/admin/member) consistently with `40_features/settings-and-admin/README.md`.

## Offline behavior summary (required)
- **Parsing**: can run fully offline (local parsing). If a fallback “upload for parse” exists, it must explicitly require online.
- **Create**: must succeed offline (local DB + outbox enqueue).
- **Media**: receipt/thumbnails can be captured/staged offline; uploads are queued and retriable; UI renders placeholders.
- **Restart**: importer draft state is allowed to be non-persistent; however, once created, the transaction/items and any staged media must survive restart via SQLite + offline media storage.
- **Reconnect**: queued create/upload ops flush; importer itself does not need realtime refresh.

## Collaboration expectations
- None while the importer screen is open (no realtime required).
- Imported entities converge through the normal project scope change-signal + delta sync.

## Performance notes
- Parsing must show explicit progress states (parsing, thumbnail extraction) and avoid freezing the UI on large PDFs.
- Debug parse report is required to diagnose template drift without console access (especially on mobile).

## Implementation reuse (porting) notes
Port/reuse-first guidance (do not recreate if avoidable):

- **Reusable logic to port (near-1:1)**:
  - PDF text extraction + line reconstruction: `src/utils/pdfTextExtraction.ts` (`extractPdfText`, `buildTextLinesFromPdfTextItems`)
  - Vendor parsers:
    - `src/utils/amazonInvoiceParser.ts` (+ `src/utils/__tests__/amazonInvoiceParser.test.ts`)
    - `src/utils/wayfairInvoiceParser.ts` (+ `src/utils/__tests__/wayfairInvoiceParser.test.ts`)
  - Draft mapping logic as reference (can be ported or used as acceptance reference):
    - `src/pages/ImportAmazonInvoice.tsx` (`buildAmazonItemDrafts`, `expandAmazonItemDrafts`, `applyParsedInvoiceToDraft`)
    - `src/pages/ImportWayfairInvoice.tsx` (`buildWayfairItemDrafts`, `expandWayfairItemDrafts`, `applyThumbnailsToDrafts`)

- **Requires platform adapters (not 1:1)**:
  - File picker / drag-drop → native document picker (RN)
  - Embedded image extraction:
    - `src/utils/pdfEmbeddedImageExtraction.ts` uses browser canvas + pdf.js rendering; the algorithm can be reused but needs a RN-capable PDF render/crop implementation
  - Clipboard/download JSON → share sheet / filesystem share on mobile
  - “Background uploads” → outbox + offline media lifecycle in SQLite-backed app

- **Non-negotiable deltas**:
  - Create must be local-atomic + outbox (no “call service then patch” as the correctness mechanism) per `40_features/sync_engine_spec.plan.md`
  - Media must follow `40_features/_cross_cutting/offline_media_lifecycle.md`

