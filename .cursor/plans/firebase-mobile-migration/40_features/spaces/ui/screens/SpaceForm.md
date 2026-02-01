# SpaceNew / SpaceEdit — Screen contract

## Intent
Create or edit a Space’s basic fields (name/notes), optionally starting from a template at creation time.

## Inputs
- Route params:
  - Create: `projectId`
  - Edit: `projectId`, `spaceId`
- Query params:
  - `returnTo` (navigation context)
- Entry points (where navigated from):
  - Spaces list “Add”
  - Space detail “Edit”
  - Inline space creation via `SpaceSelector` (in other features)

## Reads (local-first)
- Create:
  - Space templates list for the account (metadata).
- Edit:
  - Space doc by id (name/notes).

## Writes (local-first)
- Create:
  - Insert new space (project scope) with:
    - `name`, `notes`
    - `templateId` (optional)
    - `checklists` (from template, normalized to unchecked)
  - Enqueue outbox op for space create (idempotent).
- Edit:
  - Update space `name` and `notes`
  - Enqueue outbox op for space update (idempotent).

## UI structure (high level)
- Create (modal-style):
  - Header: “Create New Space” + close
  - Template picker (optional)
  - Name (required)
  - Notes (optional)
  - Actions: Cancel / Create
- Edit:
  - Header + back link
  - Form (name, notes)
  - Actions: Cancel / Save

## User actions → behavior (the contract)
- Select a template (create only):
  - Prefill name and notes from template.
  - When submitting, copy template checklists but force all items to unchecked.
- Submit:
  - Validate name required.
  - Show success toast on success.
  - Navigate back to `returnTo` if present, otherwise fallback to:
    - create: spaces list
    - edit: space detail (or spaces list if spaceId missing)
- Cancel/Close:
  - Navigate back to `returnTo` or fallback without creating/updating.

## States
- Loading:
  - Create: templates list loading state.
  - Edit: space loading state (“Loading space...”).
- Error:
  - Create: duplicate/unique error shows user-friendly message.
  - Edit: fetch/update failure shows toast and stays on screen.
- Offline:
  - Create/edit allowed as local-first (queued); template list may require cached metadata.
  - If templates aren’t available offline, the screen must still allow “Start blank”.
- Pending sync:
  - Newly created/updated spaces should appear immediately in local DB; show pending markers if available.

## Media (if applicable)
None directly (images handled in `SpaceDetail`).

## Collaboration / realtime expectations
- New/updated spaces should propagate to other devices on next delta after change-signal bump.

## Performance notes
- Template list is small; safe to load all and filter in-memory.

## Parity evidence
- Create with template picker + checklist normalization + returnTo close: `src/pages/SpaceNew.tsx`
- Edit load/save + returnTo: `src/pages/SpaceEdit.tsx`
- Template list service usage: `src/services/spaceTemplatesService.ts` (via `SpaceNew` and `SpaceDetail`)

