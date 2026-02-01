# Prompt Pack — Chat D: Tests + edge-case audit (hardening)

## Goal
Implement Phase D hardening for the offline media lifecycle:

- tests for the required attachment state machine and core lifecycle transitions
- edge-case audit across features that will use attachments

## Required reading (ground truth)
- Spec: `40_features/_cross_cutting/offline-media-lifecycle/feature_spec.md`
- Parity evidence pointers (referenced by the spec):
  - `src/services/offlineStore.ts`
  - `src/services/offlineMediaService.ts`
  - `src/services/offlineAwareImageService.ts`
  - `src/components/ui/ImageUpload.tsx`
  - `src/components/ui/StorageQuotaWarning.tsx`

## Outputs (required)
- Add tests covering:
  - `local_only → uploading → uploaded` happy path transitions
  - `uploading → failed` and retry behavior (including idempotency expectations)
  - cleanup triggers: cancel/delete/replace/post-upload
  - GC removes unreferenced blobs/jobs eventually (best-effort invariant)
- Produce an edge-case audit checklist (in code comments or an appropriate test-plan note) that enumerates:
  - entity delete mid-upload
  - attachment replace during upload
  - repeated retries across app restarts
  - quota/guardrail blocks and warnings

## Constraints
- Do not add new product features; validate existing contract only.
- Tests must respect migration architecture constraints (offline-first; no large listeners).

## Edge cases (must be explicit)
- “Stuck uploading” states after crashes/restarts: ensure there’s a deterministic resolution path.
- Terminal errors vs retryable errors: ensure tests cover both and resulting UI states are correct.
- Multi-attachment arrays vs single-field attachments: ensure both are exercised in test scenarios.

