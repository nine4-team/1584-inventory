# Invoice import — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Routing / entrypoints
- [ ] **Import routes exist**: project routes exist for both importers.  
  Observed in `src/App.tsx` (`/project/:projectId/transactions/import-wayfair`, `/project/:projectId/transactions/import-amazon`).
- [ ] **Entrypoint is discoverable from Transactions**: transactions list “Add” menu provides invoice import entrypoints.  
  Observed in `src/pages/TransactionsList.tsx` (routes `projectTransactionImport` / `projectTransactionImportAmazon`).

## Permissions
- [ ] **Access denied UI**: if user lacks account context and is not system owner, show an “Access Denied” page with a back CTA.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (guard `!currentAccountId && !isOwner()`).
- [ ] **Roles v1 mapping (mobile)**: enforce import access via Roles v1 (`owner/admin/member`) consistent with settings/admin gating.  
  **Intentional delta** (Firebase/RN security model).

## File selection + parsing
- [ ] **PDF-only file selection**: selecting a non-PDF file shows an error and does not parse.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`if (file.type !== 'application/pdf') showError(...)`).
- [ ] **Parsing is local**: parsing uses extracted PDF text and vendor parser in-app (no server required).  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`extractPdfText` → `parse{Vendor}InvoiceText`).  
  Evidence: `src/utils/pdfTextExtraction.ts`, `src/utils/{amazonInvoiceParser,wayfairInvoiceParser}.ts`.
- [ ] **Explicit progress states**: UI shows “Parsing PDF…” spinner during parse; Wayfair also shows “Extracting embedded item thumbnails…” state.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`isParsing`, `isExtractingThumbnails`).

## Parse summary + warnings
- [ ] **Parse summary renders**: after parsing, show summary fields (invoice/order id, parsed total, detected line item count).  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (parse summary card).
- [ ] **Warnings are visible**: if parser returns warnings, they are displayed prominently.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (warnings block).
- [ ] **Amazon wrong-vendor blocks create**: “Not an Amazon invoice” warning triggers a blocking error and disables create.  
  Observed in `src/utils/amazonInvoiceParser.ts` (signature check) and `src/pages/ImportAmazonInvoice.tsx` (block path in `applyParsedInvoiceToDraft` + disabled create).

## Debug parse report (anti-drift tooling)
- [ ] **Parse report exists**: a debug disclosure provides “Copy JSON” and “Download JSON” actions for a parse report.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`buildParseReport`, `copyParseReportToClipboard`, `downloadParseReportJson`).
- [ ] **Report includes extraction preview**: parse report includes file metadata + extraction stats + first \(600\) lines of extracted text.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`PARSE_REPORT_FIRST_LINE_LIMIT = 600` + `firstLines`).
- [ ] **Raw extracted text preview**: debug UI shows a raw text preview with selectable line limits (200/400/800/1600/all).  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`RAW_TEXT_PREVIEW_OPTIONS`).
- [ ] **Mobile share adaptation**: parse report can be shared via share sheet when “download” is not meaningful on mobile.  
  **Intentional delta** (platform).

## Draft transaction + itemization editor
- [ ] **Draft fields set from parse**: transaction date defaults to today then applies parsed order date; amount defaults to parsed total or sum of line item totals; notes include vendor import marker + invoice/order metadata.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`applyParsedInvoiceToDraft`).
- [ ] **Draft is editable**: user can edit date, amount, category, payment method, and notes before create.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (form inputs + `CategorySelect`).
- [ ] **Draft itemization editor**: imported items are editable in a transaction-items editor (draft mode).  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`TransactionItemsList` with `enablePersistedItemFeatures={false}`).

## Amazon-specific item mapping
- [ ] **Quantity expands into distinct items**: qty \(n\) becomes \(n\) separate draft items (no grouping).  
  Observed in `src/pages/ImportAmazonInvoice.tsx` (`expandAmazonItemDrafts`, `uiGroupKey = unique-*`).
- [ ] **Per-unit price mapping**: per-unit purchase price uses line item `unitPrice` when present, else \(total/qty\).  
  Observed in `src/pages/ImportAmazonInvoice.tsx` (`buildAmazonItemDrafts`).
- [ ] **Item notes include import marker and shipped date**.  
  Observed in `src/pages/ImportAmazonInvoice.tsx` (`baseNotesParts` includes shipped date + “Amazon import”).

## Wayfair-specific parsing + thumbnails + item mapping
- [ ] **Embedded thumbnails extracted**: importer attempts to extract embedded images and match them to line items by row order.  
  Observed in `src/pages/ImportWayfairInvoice.tsx` (`extractPdfEmbeddedImages`, `applyThumbnailsToDrafts`).
- [ ] **Thumbnail warnings**: if no thumbnails or count mismatch, show a non-blocking warning and proceed.  
  Observed in `src/pages/ImportWayfairInvoice.tsx` (`thumbnailWarning`).
- [ ] **Grouping by SKU+price**: items with SKU are grouped for edit UX by a stable group key; items without SKU are ungrouped.  
  Observed in `src/pages/ImportWayfairInvoice.tsx` (`expandWayfairItemDrafts` `uiGroupKey` logic).
- [ ] **Tax/subtotal “Other” behavior**: when parser yields calculated subtotal, default tax preset to “Other” and capture subtotal; validation ensures subtotal > 0 and subtotal \(\le\) total.  
  Observed in `src/pages/ImportWayfairInvoice.tsx` (`hasSubtotal` branch + validation for `taxRatePreset === 'Other'`).

## Create transaction + items
- [ ] **Create calls service with items**: tapping create calls `transactionService.createTransaction(..., items)` and navigates to the new transaction detail.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`handleCreate`).
- [ ] **Offline-first create is atomic (mobile)**: create must be a single local DB transaction that also enqueues an outbox op with stable idempotency keys (no double-create on retry).  
  **Intentional delta** (required by `40_features/sync_engine_spec.plan.md`).

## Media attach + background uploads + retries
- [ ] **Receipt is attached**: the selected invoice PDF is treated as a receipt attachment on the created transaction.  
  Observed in `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`receiptFile = selectedFile`, then upload/update in finalize worker).
- [ ] **Wayfair item images attached**: embedded thumbnails are uploaded and attached to the created items, with limited concurrency.  
  Observed in `src/pages/ImportWayfairInvoice.tsx` (`WAYFAIR_ASSET_UPLOAD_CONCURRENCY = 4`, uploads + `bulkUpdateItemImages`).
- [ ] **Failure messaging**: background asset upload failures show a warning instructing the user to open transaction to retry.  
  Observed in `src/pages/ImportWayfairInvoice.tsx` (`showWarning(... 'Open the transaction to retry.')`).
- [ ] **Offline media lifecycle (mobile)**: receipt + thumbnails must create local-only placeholders immediately and queue uploads; failures are retriable from transaction detail.  
  **Intentional delta** required by `40_features/_cross_cutting/offline_media_lifecycle.md`.

