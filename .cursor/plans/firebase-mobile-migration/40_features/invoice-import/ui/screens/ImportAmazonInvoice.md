# Import Amazon Invoice — Screen contract

## Intent
Let a user select an Amazon invoice PDF, parse it locally into a draft transaction + draft items, allow review/edit, then create the transaction/items in an offline-first way and attach the PDF as a receipt.

## Inputs
- Route params:
  - `projectId`
- Query params:
  - `returnTo` (optional; parity pattern)
  - `backTarget` (optional; deep link fallback)
- Entry points (where navigated from):
  - Project transactions list “Add” menu → Import → Amazon (parity: `src/pages/TransactionsList.tsx`)

## Reads (local-first)
- Project display info (name) for header context.
  - Web parity evidence: `src/pages/ImportAmazonInvoice.tsx` (`projectService.getProject` → `projectName`)
- Cached metadata dependencies:
  - Budget categories for `CategorySelect`
  - (Optional) vendor defaults / tax presets are not used on this screen, but the created transaction must be compatible with the shared transaction model.

## Writes (local-first)
For each user action:

- Select PDF
  - Local state only (draft); no DB writes.
- Parse PDF
  - Local state only (draft); no DB writes.
- Edit draft fields (date, amount, category, payment method, notes, item drafts)
  - Local state only (draft); no DB writes.
- Create transaction
  - **Local DB mutation(s)**:
    - insert transaction row (project scope)
    - insert item rows
    - link items to transaction (by foreign key)
    - create local attachment records for the invoice PDF as receipt (local-only media state)
  - **Outbox op(s)** enqueued:
    - `createTransactionWithItems` (idempotency key includes local transaction id)
    - `uploadReceiptAttachment` (idempotency key includes local attachment id)
  - **Change-signal updates**:
    - conceptually, server will bump `meta/sync` when outbox flush applies; client does not write `meta/sync` directly.

## UI structure (high level)
- Header:
  - Back CTA
  - Reset CTA
  - Title “Import Amazon Invoice” + project name subtitle
- Upload section:
  - PDF picker (mobile: file picker)
  - Parsing spinner while working
- Parse summary card:
  - Order number, parsed total, detected line items count
  - Warnings list (if any)
- Debug disclosure:
  - Parse report copy/share actions
  - Raw extracted text preview with configurable line limit
- Draft form:
  - Transaction date (date input)
  - Amount input + “sum of line items” hint
  - Budget category select
  - Payment method radio options
  - Notes textarea
  - Draft itemization editor (`TransactionItemsList` in draft mode)
- Sticky create CTA:
  - “Create Transaction” disabled while parsing or when blocked by wrong-vendor error

## User actions → behavior (the contract)
- **Back**
  - Uses native back stack; if entered via deep link/cold start, fall back to `backTarget` or project transactions list.
  - See: `40_features/navigation-stack-and-context-links/README.md`
- **Reset**
  - Clears selected file, parse result, extracted text, and restores defaults (today date, default payment method).
  - Parity evidence: `handleReset` in `src/pages/ImportAmazonInvoice.tsx`
- **Select PDF**
  - Reject non-PDF and show an error.
  - Parity evidence: `onFileSelected` in `src/pages/ImportAmazonInvoice.tsx`
- **Parse**
  - Extract text from PDF and run Amazon parser.
  - If parser returns “Not an Amazon invoice”, show a blocking error and do not populate draft items.
  - Parity evidence: `parsePdf` + `applyParsedInvoiceToDraft` in `src/pages/ImportAmazonInvoice.tsx`, `parseAmazonInvoiceText` in `src/utils/amazonInvoiceParser.ts`
- **Edit draft**
  - All edits apply immediately in the draft UI without requiring network.
  - Item drafts must enforce basic validation (non-empty description; non-negative purchase price) before create.
  - Parity evidence: `validateBeforeCreate` in `src/pages/ImportAmazonInvoice.tsx`
- **Create**
  - On success: show success feedback and navigate to transaction detail.
  - On failure: show an error and keep the draft for retry.
  - Parity evidence: `handleCreate` in `src/pages/ImportAmazonInvoice.tsx`

## States
- Loading:
  - Project name fetch may be loading; importer still usable.
- Error:
  - Parse failures show “Failed to parse PDF” + keep screen usable.
  - Wrong-vendor shows a blocking error and disables create.
- Offline:
  - Parsing is allowed offline (local).
  - Create is allowed offline (local DB + outbox); show “created (pending sync)” messaging on create.
- Pending sync:
  - After create, transaction detail should show pending sync markers and receipt upload pending state (see offline media lifecycle).
- Permissions denied:
  - Show access denied UI with a back CTA.
  - Parity evidence: guard `!currentAccountId && !isOwner()` in `src/pages/ImportAmazonInvoice.tsx`
- Quota/media blocked:
  - If storage quota prevents staging the PDF, block create and show a clear explanation.
  - Source of truth: `40_features/_cross_cutting/ui/components/storage_quota_warning.md`

## Media
- Add/select:
  - Single PDF selected (invoice) becomes a receipt attachment.
- Placeholder rendering (offline):
  - Receipt shows as `local_only` / `uploading` / `failed` with retry.
  - Source of truth: `40_features/_cross_cutting/offline_media_lifecycle.md`
- Cleanup/orphan rules:
  - If user resets or leaves without creating, staged local files should be cleaned up (best-effort).

## Collaboration / realtime expectations
- None required while screen is open.
- Created entities converge via project change-signal + delta (no large listeners).

## Performance notes
- PDF parse should not freeze UI; show progress and allow reset.
- Debug parse report is required (no console dependency on mobile).

## Parity evidence
- Screen: `src/pages/ImportAmazonInvoice.tsx`
- Parser: `src/utils/amazonInvoiceParser.ts`
- PDF text extraction: `src/utils/pdfTextExtraction.ts`

