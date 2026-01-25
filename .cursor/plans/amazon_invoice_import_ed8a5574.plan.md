---
name: Amazon invoice import
overview: Add Amazon as a supported invoice vendor by introducing an Amazon PDF parser, an Amazon import page that reuses the existing Wayfair import pipeline patterns, and updating the “Add transaction” UI to offer Import Invoice → (Wayfair, Amazon).
todos:
  - id: amazon-parser
    content: Implement `parseAmazonInvoiceText` in `src/utils/amazonInvoiceParser.ts` with header extraction, shipment grouping, line item parsing, and warnings.
    status: pending
  - id: amazon-parser-tests
    content: Add `src/utils/__tests__/amazonInvoiceParser.test.ts` covering the provided sample PDF text and key edge cases.
    status: pending
  - id: amazon-import-page
    content: Create `src/pages/ImportAmazonInvoice.tsx` reusing the Wayfair import flow (text extraction, parse report, transaction creation, receipt upload) but without thumbnail extraction.
    status: pending
  - id: routes-and-app
    content: Add Amazon import route helpers in `src/utils/routes.ts` and register routes in `src/App.tsx` (and legacy redirect parity if desired).
    status: pending
  - id: transactions-add-menu
    content: "Update `src/pages/TransactionsList.tsx` to replace the standalone import button with an Add menu: Create manually, Import Invoice → (Wayfair, Amazon)."
    status: pending
  - id: dev-script
    content: Add `scripts/parse-amazon-invoice-pdf.ts` for fast local debugging (optional but recommended).
    status: pending
  - id: docs
    content: Add a short Amazon parsing troubleshooting doc + keep the example PDF under `dev_docs/invoices/amazon/`.
    status: pending
isProject: false
---

## Context (current system)

- **Wayfair import is a dedicated page** that extracts PDF text and calls the Wayfair parser directly:
```594:643:/Users/benjaminmackenzie/Dev/ledger/src/pages/ImportWayfairInvoice.tsx
  const parsePdf = async (file: File) => {
    // ...
    const [{ fullText, pages }, embeddedImages] = await Promise.all([
      extractPdfText(file),
      (async () => {
        // Wayfair-only thumbnail extraction
        return await extractPdfEmbeddedImages(file, {
          pdfBoxSizeFilter: { min: 15, max: 180 },
          xMinMax: 220,
        })
      })(),
    ])

    setExtractedPdfText(fullText)
    setExtractedPdfPages(pages)

    const result = parseWayfairInvoiceText(fullText)
    setParseResult(result)
    setEmbeddedImagePlacements(embeddedImages)
    applyParsedInvoiceToDraft(result, embeddedImages)
  }
```

- **Transaction creation is done in the import page** and sets `source: 'Wayfair'` plus items:
```905:929:/Users/benjaminmackenzie/Dev/ledger/src/pages/ImportWayfairInvoice.tsx
      const transactionData = {
        projectId: resolvedProjectId,
        projectName,
        transactionDate,
        source: 'Wayfair',
        transactionType: 'Purchase',
        paymentMethod,
        amount: normalizeMoneyToTwoDecimalString(amount) || amount,
        categoryId: categoryId || undefined,
        notes: notes || undefined,
        // ...
      }

      const transactionId = await transactionService.createTransaction(
        currentAccountId,
        resolvedProjectId,
        transactionData as any,
        items
      )
```

- **PDF text extraction is already generic and reusable**:
```51:102:/Users/benjaminmackenzie/Dev/ledger/src/utils/pdfTextExtraction.ts
export function buildTextLinesFromPdfTextItems(items: MinimalTextItem[]): string {
  // groups tokens by Y and sorts by X
}

export async function extractPdfText(file: File): Promise<PdfTextExtractionResult> {
  // returns { pages, fullText }
}
```

- **UI currently exposes “Import Wayfair Invoice” as its own button** in the transactions list:
```795:813:/Users/benjaminmackenzie/Dev/ledger/src/pages/TransactionsList.tsx
          <ContextLink
            to={buildContextUrl(projectTransactionNew(projectId), { project: projectId })}
          >
            Add
          </ContextLink>

          <ContextLink
            to={buildContextUrl(projectTransactionImport(projectId), { project: projectId })}
            title="Import a Wayfair invoice PDF"
          >
            Import Wayfair Invoice
          </ContextLink>
```


## Target behavior

- In the “Add transaction” control, provide:
  - **Create manually**
  - **Import Invoice** → **Wayfair** / **Amazon** (explicit choice; no auto-detect required)
- Implement **Amazon PDF import** using the same overall workflow as Wayfair:
  - Extract PDF text (`extractPdfText`)
  - Parse into invoice header fields + line items
  - Pre-fill transaction fields (date, vendor/source, amount, notes)
  - Build item drafts from parsed line items
  - Create **one transaction per Amazon order** (aggregate all shipments)
  - Upload the PDF as the receipt attachment (no thumbnail extraction)

## Acceptance criteria (to keep this junior-safe)

### UI acceptance criteria

- On the project transactions list page, the primary add control is a menu/button with:
  - **Create manually** → navigates to `projectTransactionNew(projectId)`
  - **Import Invoice** → submenu:
    - **Wayfair** → navigates to the existing Wayfair import route
    - **Amazon** → navigates to the new Amazon import route
- The old standalone **“Import Wayfair Invoice”** button is removed/replaced by the menu (no duplicate entry points).

### Amazon sample PDF acceptance criteria (this repo’s example)

Using [`dev_docs/invoices/amazon/example_amazon_invoice.pdf`](/Users/benjaminmackenzie/Dev/ledger/dev_docs/invoices/amazon/example_amazon_invoice.pdf):

- Parsed header fields:
  - `orderNumber` = `114-8185066-9439459`
  - `orderPlacedDate` = `2026-01-15` (ISO)
  - `grandTotal` = `372.72`
  - `projectCode` = `Debbie Hyer - Martinique` (if present)
  - `paymentMethod` includes `Visa` and `0579` (if present)
- Parsed line items:
  - Exactly **4** items
  - Quantities = \([1, 2, 2, 1]\) in that order for the sample
  - Unit prices = \([94.99, 25.88, 75.98, 50.44]\) and totals computed as qty × unit price
- Validation:
  - Sum of line item totals equals `grandTotal` within tolerance (\(≤ $0.05\))
  - `warnings` is empty for this sample (or, if not possible due to extraction quirks, warnings are asserted explicitly in tests).

### Wrong-vendor upload behavior

- If a user selects **Amazon import** but uploads a non-Amazon PDF, the page shows a **hard error**:
  - “This PDF does not look like an Amazon order details/invoice.”
  - No items are produced and Create is disabled.
- Same idea applies to Wayfair import if we route through a menu and users can pick the wrong vendor.

## Design approach (reuse + best practices)

- **Keep vendor parsing isolated** in `src/utils/*InvoiceParser.ts` with a deterministic, test-driven parser.
- **Reuse the existing import page patterns** (parse report, warnings, transaction creation flow) while factoring out small shared helpers where it meaningfully reduces duplication.
- **Be strict about format validation**: if a user selects the wrong vendor (e.g., tries Amazon import on a Wayfair PDF), show a clear error/warning based on signature strings.
- **Guardrail: avoid big refactors**. Do not attempt to “generic-ize” the Wayfair importer while adding Amazon. Limit shared code extraction to small pure helpers (e.g., parse report builder, receipt upload helper) only if it reduces duplication without changing behavior.

## Implementation details

### 1) Add Amazon parser

- Create [`src/utils/amazonInvoiceParser.ts`](/Users/benjaminmackenzie/Dev/ledger/src/utils/amazonInvoiceParser.ts) exporting `parseAmazonInvoiceText(fullText: string)`.
- Define types mirroring the Wayfair pattern (header fields, `lineItems`, `warnings`).

#### Amazon vendor signature (must pass before parsing)

Treat as Amazon only if at least one of these appears in `fullText`:

- `Amazon.com order number:`
- `Final Details for Order #`
- `Order Placed:` AND `Amazon.com`

If signature fails, return a result with no line items and a warning like `Not an Amazon invoice` (and the importer should surface a hard error).

#### Parsing rules (ordered, explicit)

Parsing strategy for the provided PDF text:

  - **Header**:
    - Order number precedence:
      - Prefer `Amazon.com order number: <id>`
      - Else parse from `Final Details for Order #<id>`
    - Order placed date precedence:
      - Prefer `Order Placed: <date>` and parse to ISO
    - Total precedence:
      - Prefer `Grand Total: $X.XX`
      - Else `Order Total: $X.XX`
      - Else warning “Missing order total”
    - Optional “Project code:” (Business orders)
    - Payment method: `Visa | Last digits: ####`
    - Shipping address blocks (optional, mostly for notes/debug)
  - **Shipments**:
    - Split on `Shipped on <date>` sections; attach `shippedOn` to each item.
    - We still create **one transaction per order**, but `shippedOn` is preserved on each line item for notes/debug.
  - **Line items**:
    - Item start is exactly: `^(\d+)\s+of:\s*(.+)$` where group1 is `qty` and group2 is first description fragment.
    - Accumulate description lines until the next item start or shipment boundary.
    - Ignore/skip these non-item lines if encountered while accumulating (do not append to description):\n+      - `^Sold by:`\n+      - `^Condition:`\n+      - `^Business Price$`\n+      - `^Shipping Address:`\n+      - `^Shipping Speed:`\n+      - `^Item\\(s\\) Subtotal:`\n+      - `^Shipping & Handling:`\n+      - `^Total before tax:`\n+      - `^(Sales Tax|Estimated Tax):`\n+      - `^Total for This Shipment:`\n+      - `^Payment information$`\n+      - `^Billing address$`\n+      - `^Credit Card transactions`\n+      - Page markers like `^-- \\d+ of \\d+ --$`\n+    - Unit price extraction rule:\n+      - After item start, find the **first currency token** `\\$\\d{1,3}(?:,\\d{3})*\\.\\d{2}` before the next item start/shipment boundary.\n+      - That value is `unitPrice`.\n+      - If no unit price is found, warning per item and skip that item (or include with missing `unitPrice` and `total` only if you have another reliable total signal).\n+    - Total computation rule:\n+      - `total = qty * unitPrice`, normalized to 2 decimals.\n+      - Do not treat “Item(s) Subtotal” or “Total for This Shipment” as line item totals.
  - **Validation**:
    - Sum computed line totals and compare to the chosen order total; if `abs(diff) > 0.05`, add warning:\n+      - `Line totals (${sum}) do not match order total (${orderTotal}) (diff ${diff})`\n+    - Warn if required header fields are missing (order number, order date, order total, no line items).

### 2) Tests for Amazon parser

- Add [`src/utils/__tests__/amazonInvoiceParser.test.ts`](/Users/benjaminmackenzie/Dev/ledger/src/utils/__tests__/amazonInvoiceParser.test.ts).
  - Primary fixture: use the extracted text from [`dev_docs/invoices/amazon/example_amazon_invoice.pdf`](/Users/benjaminmackenzie/Dev/ledger/dev_docs/invoices/amazon/example_amazon_invoice.pdf).
  - Assert:
    - order number `114-8185066-9439459`
    - order placed date parses to `2026-01-15`
    - grand total `372.72`
    - project code is captured
    - line items: 4 items, quantities (1,2,2,1) and unit prices match; totals compute correctly
    - warnings empty (or explicitly assert known warnings if any)
  - Add a “wrong vendor” test:\n+    - Given a Wayfair-like fixture text, `parseAmazonInvoiceText` should produce `warnings` that include `Not an Amazon` (or similar) and `lineItems.length === 0`.

### 3) Add Amazon import route + page

- Add route helpers in [`src/utils/routes.ts`](/Users/benjaminmackenzie/Dev/ledger/src/utils/routes.ts):
  - Keep existing `projectTransactionImport(projectId)` as-is (Wayfair) for backward compatibility.
  - Add `projectTransactionImportAmazon(projectId)` → `/transactions/import-amazon`.
- Register route in [`src/App.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/App.tsx) alongside the Wayfair route:
  - `/project/:projectId/transactions/import-amazon`
  - (and legacy redirect path `/project/:id/transaction/import-amazon` if you want parity with Wayfair)
- Create [`src/pages/ImportAmazonInvoice.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/pages/ImportAmazonInvoice.tsx):
  - Copy the proven structure from `ImportWayfairInvoice.tsx` but:
    - call `parseAmazonInvoiceText(fullText)` instead of Wayfair
    - **do not run `extractPdfEmbeddedImages`**
    - build item drafts from Amazon line items (no thumbnails)
    - in `handleCreate`, set `source: 'Amazon'` and keep the rest aligned with Wayfair’s transaction creation contract
    - upload the selected PDF as the receipt attachment in the same background asset job style (but only the receipt, since no thumbnails)
  - Keep the parse report feature (very useful for weak/edge PDFs) to accelerate future fixes.
  - Ensure wrong-vendor upload behavior:\n+    - If parser warnings indicate “Not an Amazon invoice”, surface a user-facing error and disable Create.

### 4) Update “Add transaction” UI to match your desired menu

- In [`src/pages/TransactionsList.tsx`](/Users/benjaminmackenzie/Dev/ledger/src/pages/TransactionsList.tsx):
  - Replace the separate “Add” + “Import Wayfair Invoice” buttons with a single **Add menu**:
    - Create manually → `projectTransactionNew(projectId)`
    - Import Invoice → submenu:
      - Wayfair → existing Wayfair import route
      - Amazon → new Amazon import route
  - Reuse the existing menu patterns used in `TransactionActionsMenu` / `ItemActionsMenu` (click-outside, Escape-to-close, submenus) for a consistent UX.
  - Confirm keyboard + click-outside behavior:\n+    - Escape closes menus\n+    - Clicking outside closes menus\n+    - Submenu toggles reliably and doesn’t navigate until the user clicks an option

### 5) Developer tooling (optional but high ROI)

- Add [`scripts/parse-amazon-invoice-pdf.ts`](/Users/benjaminmackenzie/Dev/ledger/scripts/parse-amazon-invoice-pdf.ts) mirroring the Wayfair script to:
  - extract text via pdfjs in Node
  - run `parseAmazonInvoiceText`
  - print summary, line item samples, and total-diff diagnostics
  - Script success criteria:\n+    - prints parsed order number/date/total\n+    - prints line item count and a few samples\n+    - exits 0 even if warnings exist (warnings are printed)

### 6) Docs & troubleshooting

- Add a short dev doc (patterned after Wayfair) capturing:
  - known Amazon invoice variants expected
  - how to generate a parse report
  - how to reproduce and debug extraction quirks
  - Include: “How to add a new Amazon variant” checklist:\n+    - add a new fixture\n+    - add/adjust ignore-lines list\n+    - add tests asserting the new behavior

## Risks and mitigations

- **Amazon invoice variants**: Amazon has multiple “invoice/receipt/order details” formats.
  - Mitigation: signature validation + parse report + unit tests per variant; build parser to be resilient to line breaks and repeated blocks.
- **Totals mismatches**: discounts/returns/partial shipments can cause computed line totals to diverge.
  - Mitigation: treat mismatch as a warning; prefer declared `Grand Total` for the transaction amount.