## Goal
Produce parity-grade specs for `invoice-import`.

## Inputs to review (source of truth)
- Feature map entry: `40_features/feature_list.md` → **Feature 13: Invoice import** (`invoice-import`)
- Sync engine spec (offline-first invariants): `40_features/sync_engine_spec.plan.md`
- Offline media lifecycle (attachments/images as local-only → uploading → uploaded): `40_features/_cross_cutting/offline_media_lifecycle.md`
- Storage/quota guardrails: `40_features/_cross_cutting/ui/components/storage_quota_warning.md`
- Shared Items + Transactions module contract (item draft editing UX reuse): `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`

## Owned screens (list)
- `ImportAmazonInvoice` — contract required? **yes**
  - why: long-running local parsing + draft transaction composition + create semantics + parse-report/debug tooling
- `ImportWayfairInvoice` — contract required? **yes**
  - why: embedded thumbnail extraction + background asset upload + draft item grouping + tax/subtotal special-casing

## Cross-cutting dependencies (link)
- Navigation/back behavior + `returnTo` handling: `40_features/navigation-stack-and-context-links/README.md`
- Transactions (create + itemization draft UX surface): `40_features/project-transactions/README.md`
- Presets/metadata availability (categories/tax/vendors): `40_features/settings-and-admin/README.md`

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Screen contracts (required):
- `ui/screens/ImportAmazonInvoice.md`
- `ui/screens/ImportWayfairInvoice.md`

Optional extras (only if needed later):
- `flows/*.md` (e.g., background asset upload + retry UX)
- `data/*.md` (parser compatibility notes, vendor format drift policy)

## Prompt packs (copy/paste)
Create `prompt_packs/` with 2–4 slices. Each slice must include:
- exact output files
- source-of-truth code pointers (file paths)
- evidence rule

Recommended slices:
- Slice A: screen contracts (import flows + validation + UX states)
- Slice B: parsing + debug tooling (parse report, warnings, extraction heuristics)
- Slice C: media/background asset upload + offline-first adaptation (outbox + placeholders + retries)

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (pending + restart + reconnect + queued uploads).
- Cross-links are complete (feature docs ↔ screen contracts ↔ sync engine + offline media docs).

