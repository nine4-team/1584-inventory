# Goal
Spec the parsing + debug tooling requirements for invoice import (Amazon + Wayfair), including how we diagnose vendor template drift on mobile without console access.

## Outputs (required)
Update or create:
- `40_features/invoice-import/feature_spec.md`
- `40_features/invoice-import/acceptance_criteria.md`

If needed, add:
- `40_features/invoice-import/data/parsing_and_debug_tooling.md`

## Source-of-truth code pointers
Text extraction:
- `src/utils/pdfTextExtraction.ts` (`extractPdfText`, `buildTextLinesFromPdfTextItems`)

Vendor parsers + tests:
- `src/utils/amazonInvoiceParser.ts`
- `src/utils/__tests__/amazonInvoiceParser.test.ts`
- `src/utils/wayfairInvoiceParser.ts`
- `src/utils/__tests__/wayfairInvoiceParser.test.ts`

Wayfair embedded images:
- `src/utils/pdfEmbeddedImageExtraction.ts` (`extractPdfEmbeddedImages`)
- `src/pages/ImportWayfairInvoice.tsx` (`applyThumbnailsToDrafts`, thumbnail warnings)

Importer debug UX:
- `src/pages/{ImportAmazonInvoice,ImportWayfairInvoice}.tsx` (`buildParseReport`, `copyParseReportToClipboard`, `downloadParseReportJson`, raw text preview)

## Evidence rule (anti-hallucination)
For each “must capture” debug field and warning behavior, cite where it exists today or mark as intentional delta.

## Constraints / non-goals
- Do not redesign parsers; focus on the observable contract: inputs, outputs, warning semantics, and debug artifacts.
- Ensure the debug artifacts are feasible on mobile (share sheet preferred).

