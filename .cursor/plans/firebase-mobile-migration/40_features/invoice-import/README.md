# Invoice import (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **vendor invoice import** flows (Amazon + Wayfair PDF import), grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

## Scope
- Import Amazon invoice PDF into a draft transaction + draft items
- Import Wayfair invoice PDF into a draft transaction + draft items (including embedded thumbnail extraction)
- Review/edit the draft (transaction fields + item drafts) before creating
- Create the transaction + items, and attach media (receipt PDF + item thumbnails) with robust queued upload behavior
- Parse-report/debug tooling to diagnose vendor template drift

## Non-scope (for this feature folder)
- Core Transactions list/detail/edit behavior — `40_features/project-transactions/README.md`
- Core Items behavior outside the import draft editor — `40_features/project-items/README.md`
- Deep inventory operations semantics (allocate/move/sell/deallocate/lineage) — `40_features/inventory-operations-and-lineage/README.md`
- Pixel-perfect UI design

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts**:
  - `ui/screens/ImportAmazonInvoice.md`
  - `ui/screens/ImportWayfairInvoice.md`

## Cross-cutting dependencies
- Offline-first invariants + change-signal + delta sync: `40_features/sync_engine_spec.plan.md`
- Offline media lifecycle (receipt + item thumbnails): `40_features/_cross_cutting/offline_media_lifecycle.md`
- Storage/quota guardrails: `40_features/_cross_cutting/ui/components/storage_quota_warning.md`
- Navigation/back behavior: `40_features/navigation-stack-and-context-links/README.md`

## Parity evidence (web sources)
- Amazon importer screen + create behavior:
  - `src/pages/ImportAmazonInvoice.tsx`
- Wayfair importer screen + thumbnail extraction + background asset upload:
  - `src/pages/ImportWayfairInvoice.tsx`
- PDF text extraction line reconstruction:
  - `src/utils/pdfTextExtraction.ts` (`extractPdfText`, `buildTextLinesFromPdfTextItems`)
- Wayfair embedded image extraction (thumbnail cropping):
  - `src/utils/pdfEmbeddedImageExtraction.ts` (`extractPdfEmbeddedImages`)
- Vendor parsers + tests:
  - `src/utils/amazonInvoiceParser.ts`, `src/utils/__tests__/amazonInvoiceParser.test.ts`
  - `src/utils/wayfairInvoiceParser.ts`, `src/utils/__tests__/wayfairInvoiceParser.test.ts`

