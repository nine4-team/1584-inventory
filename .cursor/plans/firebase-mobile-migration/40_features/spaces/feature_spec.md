# Spaces — Feature spec (Firebase mobile migration)

## Intent
Provide a local-first Spaces experience inside a project: users can browse/search spaces, create/edit/delete spaces, and manage a space’s items, images, and checklists with predictable offline behavior. While foregrounded and online, the app should feel “fresh” without subscribing to large collections (use change-signal + delta sync).

## Definitions
- **Space**: a location/grouping entity used to organize items.
- **Space template**: an account-wide preset used to prefill a new space (name/notes/checklists).

Migration stance (intentional model choice):
- **Spaces are project-scoped**. We do not model “account-wide spaces” as real Space records in the target app; the reusable/account-wide concept is **templates**.

Parity note (web legacy behavior to not carry forward as-is):
- The web data model and UI include traces of `space.projectId === null` (“Account-wide space”). Treat that as legacy; do not build new product behavior around it for the migration.

## Owned screens / routes
- **Spaces list**: `ProjectSpacesPage`
  - Route: `/project/:projectId/spaces`
  - Web parity source: `src/pages/ProjectSpacesPage.tsx`
- **Create space**: `SpaceNew`
  - Route: `/project/:projectId/spaces/new`
  - Web parity source: `src/pages/SpaceNew.tsx`
- **Space detail**: `SpaceDetail`
  - Route: `/project/:projectId/spaces/:spaceId`
  - Web parity source: `src/pages/SpaceDetail.tsx`
- **Edit space**: `SpaceEdit`
  - Route: `/project/:projectId/spaces/:spaceId/edit`
  - Web parity source: `src/pages/SpaceEdit.tsx`

Screen contracts:
- `ui/screens/ProjectSpacesList.md`
- `ui/screens/SpaceDetail.md`
- `ui/screens/SpaceForm.md`

## Primary flows

### 1) Browse/search spaces
Summary:
- Spaces render in a grid of cards with:
  - primary image (or placeholder)
  - space name
  - item count (derived from items with `item.spaceId`)
- Search filters spaces by `name` and `notes` substring matches (case-insensitive).

Parity evidence:
- List/search + empty states: `src/pages/ProjectSpacesPage.tsx`
- Offline image resolution: `src/components/spaces/SpacePreviewCard.tsx`

### 2) Create a space (optionally from template)
Summary:
- Create is launched from the Spaces list “Add”.
- A template picker can prefill `name` and `notes` (and supply checklists).
- Validation: `name` required.
- On success: show success toast, refresh collections, and close (returnTo / fallback).

Template checklist normalization (required):
- When creating from a template, template checklist items are copied but forced to `isChecked=false` at creation time.

Parity evidence:
- Template picker and prefill: `src/pages/SpaceNew.tsx`
- Checklist normalization: `normalizeChecklistsFromTemplate` in `src/pages/SpaceNew.tsx`
- Success + refresh: `refreshCollections({ includeProject: false })` in `src/pages/SpaceNew.tsx`

### 3) View space detail (tabs: Items / Images / Checklists)
Summary:
- Space detail shows:
  - header/back + actions menu
  - name
  - notes section
  - tabs:
    - Items: manage items assigned to the space
    - Images: manage space images (add/remove/set primary)
    - Checklists: manage checklists and checklist items

Parity evidence:
- Tab UI and action menu: `src/pages/SpaceDetail.tsx`

### 4) Assign/manage items in a space (Space detail → Items tab)
Summary:
- Items tab uses the shared itemization UI (`TransactionItemsList`) in “space context”:
  - Create a new item “in space”
  - Update existing item fields
  - Duplicate items
  - Bulk move selected items to another space
  - Bulk remove selected items from the current space
- “Add Existing Items” opens a modal picker that supports:
  - search project items
  - select all
  - duplicate-group aware selection
  - bulk add selected items to the space (sets `item.spaceId = <spaceId>`)

Parity evidence:
- Items tab wiring + bulk handlers: `src/pages/SpaceDetail.tsx` (TransactionItemsList props and `bulkSetSpaceId` / `bulkUnassignSpace`)
- Add existing items modal: `src/pages/SpaceDetail.tsx` + `src/components/spaces/SpaceItemPicker.tsx`

Migration notes:
- In Firebase/RN, these are local-first item mutations:
  - set/clear `item.spaceId`
  - and (optional, parity): set human-readable `item.space` name for display if retained in the data contract
- Do not implement a listener on all items for “live item counts” in a project. The project scope should use `meta/sync` change-signal + delta per `40_features/sync_engine_spec.plan.md`.

### 5) Manage space images (Space detail → Images tab)
Summary:
- User can add multiple images; uploads may create `offline://` placeholder URLs (renderable immediately).
- User can remove images and set a primary image.
- Image grid supports lightbox/gallery behavior consistent with the cross-cutting contract.

Parity evidence:
- Add images + upload activity UI: `src/pages/SpaceDetail.tsx` (`handleAddImage`, `UploadActivityIndicator`)
- Remove/set primary: `src/pages/SpaceDetail.tsx` (`handleRemoveImage`, `handleSetPrimaryImage`)
- Offline placeholders + resolution on cards: `src/components/spaces/SpacePreviewCard.tsx` (offline blob resolution)
- Cross-cutting gallery: `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

### 6) Manage checklists (Space detail → Checklists tab)
Summary:
- A space holds an ordered array of checklists; each checklist holds an ordered array of checklist items.
- Checklist behaviors are “inline edit with commit”:
  - Add checklist (default name “New Checklist”), immediately persists.
  - Rename checklist: click name to edit; commit on blur or Enter; empty names become “Checklist”.
  - Delete checklist: immediately persists.
  - Toggle checklist item checked state: immediately persists.
  - Rename checklist item: click to edit; commit on blur or Enter; Escape cancels edit; empty text becomes “Item”.
  - Add checklist item: Enter or “Add” button; new item defaults to unchecked; immediately persists.
  - Delete checklist item: immediately persists.

Parity evidence:
- Checklists UI and commit rules: `src/pages/SpaceDetail.tsx` (`updateChecklists`, `commitChecklistName`, `commitChecklistItemText`, inline handlers)

Migration notes:
- For Firebase/RN, checklist edits should map to a single local DB transaction and an outbox op that updates `space.checklists` deterministically (and is conflict-aware).

### 7) Save space as template (admin-only)
Summary:
- From SpaceDetail actions menu, admin can “Save as Template”.
- Template form defaults to the space’s name/notes.
- Template checklists are copied but normalized so all items are unchecked before saving.

Parity evidence:
- Admin-only action + modal + normalization: `src/pages/SpaceDetail.tsx` (`isAdmin` gate, `normalizeChecklistsForTemplate`, `spaceTemplatesService.createTemplate`)

Out-of-scope linkage:
- Managing templates (archive/rename/edit template checklists) belongs to settings/presets (`settings-and-admin`).

### 8) Edit space
Summary:
- Edit updates `name` and `notes`.
- Navigation respects `returnTo` and falls back to space detail or spaces list.

Parity evidence:
- Edit load + save + returnTo: `src/pages/SpaceEdit.tsx`

### 9) Delete space
Summary:
- Delete is confirmed.
- If the space has items assigned, show a warning that items will not be deleted but their space assignment will be cleared.
- On success: navigate back to Spaces list.

Parity evidence:
- Delete confirm + warning: `src/pages/SpaceDetail.tsx` (`showDeleteConfirm` block)
- Delete request: `spaceService.deleteSpace` in `src/services/spaceService.ts`

Migration note:
- In Firebase, enforce “clear assignment” semantics server-side if needed (e.g., on delete, clear `item.spaceId` for affected items) to avoid orphaned references.

## Offline-first behavior (mobile target)

### Local source of truth
- UI renders from local DB (SQLite on mobile).
- User writes are local-first; remote sync is via outbox.
- Media attachments are represented locally immediately; uploads may create `offline://<mediaId>` placeholders.

### Restart behavior
- On cold start:
  - Spaces list should render from local cache (avoid empty flash).
  - Space detail should render from local cache (space + images + checklists + assigned items).

### Reconnect behavior
- When returning online, foregrounded project should converge via change-signal + delta and clear any “hydrated from cache” stale indicator.

Canonical migration source:
- `40_features/sync_engine_spec.plan.md`

## Collaboration / “realtime” expectations (mobile target)
- Do not subscribe to large collections (items/spaces) for realtime.
- While foregrounded in an active project:
  - listen only to `accounts/{accountId}/projects/{projectId}/meta/sync`
  - trigger delta fetches for `spaces` and any affected `items` on signal bump

Canonical migration source:
- `40_features/sync_engine_spec.plan.md`

## Permissions and gating
- User must be authenticated and have an active `accountId` to manage spaces.
- “Save as Template” is admin-only (client gating for UX; server enforcement required).

