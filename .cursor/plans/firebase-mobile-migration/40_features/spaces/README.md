# Spaces (Firebase mobile migration feature spec)

This folder defines the parity-grade behavior spec for Ledger’s **Spaces** experience (spaces list + space detail), grounded in the existing web app and adapted to the React Native + Firebase **offline-first** architecture.

Spaces are location/grouping entities used to organize items.

Important terminology clarification for this migration:

- **Spaces are project-scoped** (a space belongs to exactly one project).
- **Templates are account-wide** (presets used to create a new space; managed under Settings/Presets).

## Scope
- Browse/search spaces for a project
- Create a space (optionally starting from a template)
- View a space detail and manage:
  - Items assigned to the space (add existing, create new in-space, bulk move/unassign)
  - Space images (upload/remove/set primary)
  - Space checklists (CRUD checklist + checklist items; check/uncheck)
- Edit space name/notes
- Delete a space (items are not deleted; their space assignment is cleared)
- Admin-only: “Save as template” from a space detail (template management lives elsewhere)

## Non-scope (for this feature folder)
- Full Item CRUD specs (owned by the **shared Items module**; authored in `project-items/` and reused in business-inventory scope per `40_features/_cross_cutting/ui/shared_items_and_transactions_modules.md`)
- Transaction itemization behavior (owned by `project-transactions`)
- Inventory allocation/lineage semantics (owned by `inventory-operations-and-lineage`)
- Full templates management UX (owned by `settings-and-admin` presets)
- “Account-wide spaces” as real Space records (`space.projectId === null`) — treated as legacy and out-of-scope for the migration model
- Pixel-perfect UI design

## Key docs
- **Feature spec**: `feature_spec.md`
- **Acceptance criteria**: `acceptance_criteria.md`
- **Screen contracts**:
  - `ui/screens/ProjectSpacesList.md`
  - `ui/screens/SpaceDetail.md`
  - `ui/screens/SpaceForm.md`

## Cross-cutting dependencies
- Sync architecture constraints (change-signal + delta, local-first): `40_features/sync_engine_spec.plan.md`
- Image gallery/lightbox (shared behavior): `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`
- Presets/space templates (create/list templates): `40_features/feature_list.md` → “Settings + presets”

## Parity evidence (web sources)
- Routes: `src/utils/routes.ts` (`projectSpaces`, `projectSpaceDetail`, `projectSpaceNew`, `projectSpaceEdit`)
- Spaces list: `src/pages/ProjectSpacesPage.tsx`
- Space detail (tabs, items/images/checklists, save as template): `src/pages/SpaceDetail.tsx`
- Create space (template picker): `src/pages/SpaceNew.tsx`
- Edit space: `src/pages/SpaceEdit.tsx`
- Space service: `src/services/spaceService.ts`
- Space card (offline image resolution): `src/components/spaces/SpacePreviewCard.tsx`
- Add existing items modal: `src/components/spaces/SpaceItemPicker.tsx`
- Space selector (inline create): `src/components/spaces/SpaceSelector.tsx`

