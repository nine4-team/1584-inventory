## Goal
Produce parity-grade specs for `spaces`.

## Inputs to review (source of truth)
- Feature list entry: `40_features/feature_list.md` → **Feature 9: Spaces** (`spaces`)
- Sync engine spec: `40_features/sync_engine_spec.plan.md`
- Cross-cutting UI: `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

## Owned screens (list)
- `ProjectSpacesPage` — contract required? **yes**
  - why: list/search behavior + empty state + item counts per space.
- `SpaceDetail` — contract required? **yes**
  - why: multi-tab screen + checklist inline edits (auto-commit) + add existing items modal + media actions + bulk move/unassign.
- `SpaceNew`/`SpaceEdit` — contract required? **yes**
  - why: template picker + returnTo/back behavior + validation and failure states.

## Cross-cutting dependencies (link)
- Media placeholder + gallery behavior: `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`
- Offline-first invariants: `40_features/sync_engine_spec.plan.md`
- Template management surface (presets): `40_features/feature_list.md` → “Settings + presets”

## Output files (this work order will produce)
Minimum:
- `README.md`
- `feature_spec.md`
- `acceptance_criteria.md`

Screen contracts (required):
- `ui/screens/ProjectSpacesList.md`
- `ui/screens/SpaceDetail.md`
- `ui/screens/SpaceForm.md`

## Prompt packs (copy/paste)
Create `prompt_packs/` with 2–4 slices. Each slice must include:
- exact output files
- source-of-truth code pointers (file paths)
- evidence rule

Recommended slices:
- Slice A: Spaces list + create/edit/delete flows
- Slice B: Space detail — items assignment + add existing items modal + bulk actions
- Slice C: Space detail — images + templates + offline media placeholders
- Slice D (optional): Checklists editing semantics + conflict strategy

## Done when (quality gates)
- Acceptance criteria all have parity evidence or explicit deltas.
- Offline behaviors are explicit (pending + restart + reconnect).
- Collaboration behavior is explicit and uses change-signal + delta (no large listeners).
- Cross-links are complete (spaces ↔ screen contracts ↔ sync engine ↔ cross-cutting media docs).

