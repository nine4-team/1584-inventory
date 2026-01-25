# Amazon Invoice Import

This directory contains documentation and examples for Amazon invoice import functionality.

## Overview

The Amazon invoice import feature allows users to import Amazon order details PDFs and automatically create transactions with line items. The parser extracts order information, line items, and creates transaction drafts that can be reviewed before creation.

## Example PDF

- `example_amazon_invoice.pdf` - A sample Amazon order details PDF used for testing and development

## How It Works

1. **PDF Text Extraction**: The PDF is processed using pdfjs to extract text content
2. **Vendor Signature Check**: The parser verifies the PDF is an Amazon invoice by checking for signature strings:
   - `Amazon.com order number:`
   - `Final Details for Order #`
   - `Order Placed:` AND `Amazon.com`
3. **Header Parsing**: Extracts order number, order date, grand total, project code (if present), and payment method
4. **Line Item Parsing**: Parses line items using the pattern `^(\d+)\s+of:\s*(.+)$` to identify items
5. **Price Extraction**: Finds unit prices by locating the first currency token after each item description
6. **Validation**: Validates that line item totals match the grand total (within $0.05 tolerance)

## Known Invoice Variants

The parser is designed to handle standard Amazon order details PDFs. Key characteristics:

- Order number format: `###-#######-#######`
- Date format: `Month DD, YYYY` (e.g., "January 15, 2026")
- Line items start with quantity pattern: `1 of:`, `2 of:`, etc.
- Prices appear as standalone lines after item descriptions
- Shipments are separated by `Shipped on <date>` sections

## Debugging

### Parse Report

The import page includes a "Parse report (debug)" section that shows:
- Extracted raw text (first N lines)
- Parsed line items
- Warnings and errors
- Full JSON export for debugging

### Dev Script

Use the dev script to quickly test parsing:

```bash
npm run tsx scripts/parse-amazon-invoice-pdf.ts [path-to-pdf]
```

The script will output:
- Parsed order number, date, total
- Line item count and samples
- Total validation (sum vs grand total)
- Warnings

## Adding Support for New Variants

If you encounter a new Amazon invoice variant that doesn't parse correctly:

1. **Add a test fixture**: Save the PDF text or create a test case in `amazonInvoiceParser.test.ts`
2. **Update ignore patterns**: Add any new non-item lines to the `IGNORE_LINES` array in `amazonInvoiceParser.ts`
3. **Adjust parsing logic**: Update the parser to handle the new format
4. **Add tests**: Write tests asserting the new behavior
5. **Update documentation**: Document the variant in this file

## Troubleshooting

### "Not an Amazon invoice" error

- Verify the PDF contains Amazon signature strings
- Check that the PDF text extraction is working (view parse report)
- Ensure the PDF is an order details/invoice, not a shipping confirmation

### Missing line items

- Check the parse report to see what text was extracted
- Verify item start patterns match `^(\d+)\s+of:\s*(.+)$`
- Check if prices are being detected (look for currency tokens)

### Totals mismatch

- Amazon invoices include tax in the grand total but not in individual line items
- This is expected and will generate a warning
- The parser uses the declared grand total for the transaction amount

### Missing unit prices

- Unit prices should appear as standalone lines after item descriptions
- Check the parse report to see if prices are being extracted
- Verify the price line isn't being ignored by the ignore patterns

## Related Files

- `src/utils/amazonInvoiceParser.ts` - Main parser implementation
- `src/utils/__tests__/amazonInvoiceParser.test.ts` - Parser tests
- `src/pages/ImportAmazonInvoice.tsx` - Import page UI
- `scripts/parse-amazon-invoice-pdf.ts` - Dev debugging script
