# Goal
Spec the offline-first media and “background upload” semantics for invoice import:
- receipt PDF attachment
- Wayfair embedded thumbnail → item image attachments
- retries + failure UX

## Outputs (required)
Update or create:
- `40_features/invoice-import/feature_spec.md`
- `40_features/invoice-import/acceptance_criteria.md`

Cross-cutting (only if missing details are discovered):
- `40_features/_cross_cutting/offline_media_lifecycle.md` (update only if truly required)

## Source-of-truth code pointers
Web parity “background upload” workers:
- `src/pages/ImportAmazonInvoice.tsx` (`finalizeAmazonImportReceipt`)
- `src/pages/ImportWayfairInvoice.tsx` (`finalizeWayfairImportAssets`, concurrency limiter, error/warn copy)

Upload helpers:
- `src/services/imageService.ts` (`ImageUploadService`)

Transaction/item patch surfaces:
- `src/services/inventoryService.ts` (`transactionService`, `unifiedItemsService`)

## Evidence rule (anti-hallucination)
For each state (upload queued / uploading / success / partial failure / retry), cite parity evidence or mark as intentional delta required by the offline-first architecture.

## Constraints / non-goals
- The RN/Firebase implementation must use the outbox + offline media lifecycle. Do not specify direct “upload then patch” as a required mechanism.

