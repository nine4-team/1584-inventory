## Wayfair PDF → Transaction + Items import plan

### Goal
Enable a user to upload a Wayfair invoice PDF (e.g. `dev_docs/Invoice_4386128736.pdf`), preview the extracted invoice data, and create:
- **1 transaction** in `transactions`
- **N associated items** in `items` (via existing `transactionService.createTransaction(..., items)` + `unifiedItemsService.createTransactionItems(...)`)

### Non-goals (for v1)
- Supporting arbitrary vendor PDFs (Wayfair-only first).
- Perfect reconciliation across partial shipments (we’ll represent what’s on the invoice; shipped vs “to be shipped” can be handled as notes/status if desired).
- Auto-uploading the PDF as an attachment (optional follow-up).

### Existing building blocks (already in codebase)
- **Create transaction + items**: `transactionService.createTransaction(accountId, projectId, transactionData, items)`
- **Create items linked to transaction**: `unifiedItemsService.createTransactionItems(...)`
- **Item form type**: `TransactionItemFormData` (`src/types/index.ts`)
- **Routing**: `src/App.tsx` contains project transaction routes; we’ll add an import page route.

### UX / Flow (v1)
- Add a new page: `ImportWayfairInvoice.tsx` (**TODO**)
- Entry points:
  - **Project context**: `/project/:id/transaction/import-wayfair`
  - (Optional) **Business inventory context**: `/business-inventory/transaction/import-wayfair` (later)
- Page steps:
  - **Upload PDF** (drag/drop + file picker)
  - **Parse + Extract** (show progress and any warnings)
  - **Preview**:
    - Transaction fields: date, source, payment method, total, notes
    - Items table: description, qty, unit price, item total, tax, adjustment (if captured), derived purchase price
  - **Edit before create**:
    - Allow editing transaction date, payment method, category (optional), and per-item description/price
  - **Create**:
    - Call existing `transactionService.createTransaction(...)` with computed transaction + `TransactionItemFormData[]`
    - Navigate to the created transaction detail page

### Parsing architecture
- Use `pdfjs-dist` client-side to extract text from the PDF (no server dependency).
  - Implement a utility: `src/utils/pdfTextExtraction.ts`
    - `extractPdfText(file: File): Promise<{ pages: string[]; fullText: string }>`
    - Configure PDF.js worker for Vite (ensure the worker is bundled and reachable).
- ✅ Implemented: `src/utils/pdfTextExtraction.ts` (uses `pdfjs-dist` legacy build + worker URL import)
- Implement a Wayfair-specific parser: `src/utils/wayfairInvoiceParser.ts`
  - Input: extracted `fullText` (or `pages`)
  - Output:
    - `invoiceNumber?: string`
    - `orderDate?: string` (YYYY-MM-DD)
    - `invoiceLastUpdated?: string`
    - `orderTotal?: string` (two-decimal string)
    - `subtotal?: string`
    - `taxTotal?: string`
    - `adjustmentsTotal?: string`
    - `lineItems: Array<{ description: string; qty: number; unitPrice?: string; subtotal?: string; adjustment?: string; tax?: string; total: string }>`
    - `warnings: string[]`
- ✅ Implemented: `src/utils/wayfairInvoiceParser.ts` + `src/utils/money.ts`

### Mapping: parsed invoice → app transaction + items
- **Transaction**
  - `transactionDate`: use invoice/order date if parseable; else default to today and warn
  - `source`: `"Wayfair"` (or `"Wayfair LLC"`, but prefer `"Wayfair"` for vendor consistency)
  - `transactionType`: `"Purchase"`
  - `paymentMethod`: default `"Client Card"` or `"Pending"` (match your conventions); allow user edit
  - `amount`: invoice/order total (two decimals)
  - `notes`: include invoice metadata (invoice number, last updated, shipment split summary) to preserve context
  - `taxRatePreset` / `subtotal`:
    - For v1, set `taxRatePreset = 'Other'` and set `subtotal` from invoice subtotal if available.
    - This lets `transactionService.createTransaction` compute `taxRatePct` automatically.
    - If subtotal is missing/unreliable, omit tax fields and just store total; warn user.
- **Items**
  - Expand `qty > 1` into multiple items (because `TransactionItemFormData` does not have quantity).
    - Each item uses:
      - `description`: use line item description; optionally suffix `(#i of qty)` if needed for uniqueness
      - `purchasePrice`: per-unit or per-item derived price:
        - Preferred: use the line’s “Total” divided by qty (two decimals)
        - If “Total” missing but unit price exists, use unit price
      - `price`: set same as `purchasePrice` (keeps UI consistent)
      - `sku`: parse if present (Wayfair sometimes includes SKUs/IDs); otherwise blank
      - `notes`: include adjustment/tax fields if we parsed them and they’re not representable elsewhere
  - If the invoice total includes adjustments/tax separately, ensure we do not double-count by:
    - Treating each item’s `purchasePrice` as the line “Total” (already includes tax/adjustment for that line).

### Handling shipment groups (important for this invoice)
Wayfair invoices often contain multiple “Shipped On …” sections and an “Items to be Shipped” section.
- For v1:
  - Include **all line items** (shipped + to be shipped) in the transaction preview by default.
  - Add a toggle list allowing the user to exclude “Items to be Shipped” if they want to only book shipped items now.
  - When excluded, update transaction amount to the sum of included line totals (and warn that it may not match invoice order total).

### Validation & reconciliation rules
- Compute:
  - `sumLineTotals = Σ(line.total)`
  - If `abs(sumLineTotals - invoiceOrderTotal) > $0.05`, show a warning and allow user to proceed.
- Ensure every generated `TransactionItemFormData` has:
  - `id` (temporary UI id)
  - `description` non-empty
  - `purchasePrice` parsable number >= 0

### Files to add/change
- **New**
  - `src/pages/ImportWayfairInvoice.tsx` (**TODO**)
  - ✅ `src/utils/pdfTextExtraction.ts`
  - ✅ `src/utils/wayfairInvoiceParser.ts`
  - ✅ `src/utils/money.ts` (normalize `$1,234.56` → `"1234.56"`)
- **Update**
  - `src/App.tsx`: add route(s) for the new page (**TODO**)
  - (Optional) add a nav entry/button in `ProjectDetail` or transaction list (**TODO**)
- **Dependencies**
  - Add `pdfjs-dist`

### Testing plan
- **Parser unit tests** (`vitest`)
  - Add a fixture: extracted text snippet representing key sections (header + a few line items).
  - Validate line-item count, totals, and date extraction.
- ✅ Implemented: `src/utils/__tests__/wayfairInvoiceParser.test.ts` (fixture-based)
- **Manual UI test**
  - Upload `dev_docs/Invoice_4386128736.pdf`
  - Confirm preview shows:
    - Invoice number `4386128736`
    - Order total `$12,580.48`
    - Many line items across shipped dates + items-to-be-shipped
  - Create transaction and confirm:
    - Transaction exists and navigates correctly
    - Items created and linked (`item_ids` updated on transaction)
    - Sum of item purchase prices matches expectation (or warning acknowledged)

### Rollout / Safety
- Hide behind a small “Importer (beta)” entry point initially.
- Ensure errors are non-destructive:
  - Parsing failures never create DB records.
  - Creation is a single action; show a confirmation.
- Logging:
  - Log parse warnings to console for debugging; optionally surface a copyable “Parse report” in UI.

### Follow-ups (v2+)
- Store the original PDF in Supabase Storage and link it to the transaction as a receipt attachment.
- Support additional vendor templates (Amazon, Home Depot, etc.) via pluggable parser interface.
- Better shipment modeling (create separate transactions per “Shipped On” date if desired).


