## Goal
Produce parity-grade specs for `project-transactions`.

## Inputs to review (source of truth)
- Feature map entry: `40_features/feature_list.md` → **Feature 7: Project transactions** (`project-transactions`)
- Sync engine spec: `40_features/sync_engine_spec.plan.md`
- Relevant existing specs:
  - Navigation + stacked back/scroll restore: `40_features/feature_list.md` → **Feature 15** (`navigation-stack-and-context-links`) (parity evidence in web)
  - Canonical transaction semantics + item-driven attribution: `40_features/project-items/feature_spec.md`

## Owned screens (list)
- `ProjectTransactionsPage` / `TransactionsList` — contract required? **yes**
  - why: high-branching list (search/filter/sort/export), state persistence, canonical total self-heal.
- `AddTransaction` / `EditTransaction` — contract required? **yes**
  - why: offline prerequisite gating + metadata dependencies + media uploads + itemization.
- `TransactionDetail` — contract required? **yes**
  - why: media upload + offline placeholders + delete semantics + image gallery/pinning + itemization + cross-scope actions.

## Cross-cutting dependencies (link)
- Sync architecture constraints (local-first + outbox + change-signal + delta): `40_features/sync_engine_spec.plan.md`
- Image gallery/lightbox behavior (shared UI): `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`
- Inventory operations + lineage (transaction↔item linking/move/sell semantics): `40_features/inventory-operations-and-lineage/README.md`

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Screen contracts (required):
- `ui/screens/TransactionsList.md`
- `ui/screens/TransactionForm.md`
- `ui/screens/TransactionDetail.md`

Cross-cutting (required):
- `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

## Prompt packs (copy/paste)
Create `prompt_packs/` with 2–4 slices. Each slice must include:
- exact output files
- source-of-truth code pointers (file paths)
- evidence rule

Recommended slices:
- Slice A: Transactions list (filters/sort/search/export + state persistence)
- Slice B: Transaction form (create/edit + metadata gating + itemization + media)
- Slice C: Transaction detail (media + gallery + items + action menu)

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (pending + retries + restart + reconnect).
- Collaboration behavior references change-signal + delta (no large listeners).
- Cross-links are complete (feature docs ↔ screen contracts ↔ sync engine spec ↔ cross-cutting docs).

