# SpaceDetail — Screen contract

## Intent
Let a user view and manage a single Space: assigned items, space images, and checklists.

## Inputs
- Route params:
  - `projectId`
  - `spaceId`
- Query params:
  - `returnTo` (navigation context)
- Entry points (where navigated from):
  - Spaces list card tap
  - Deep link from item “space” field (future)

## Reads (local-first)
- Local DB queries:
  - Space by `spaceId`
  - Project by `projectId` (for display + media folder naming)
  - Assigned items by `projectId` + `spaceId`
- Derived view models:
  - Items tab view model for itemization-style list (`TransactionItemsList`-like UI).
  - Tabs state: `items` | `images` | `checklists`.

## Writes (local-first)
### Items tab
- Create item “in space”:
  - Insert item with `spaceId=<spaceId>` and project scope set.
  - Upload item images (may produce offline placeholders) and patch item `images`.
  - Enqueue outbox ops for item create/update and media attach.
- Update item:
  - Patch item fields and ensure `spaceId=<spaceId>`.
  - Upload any new images and patch `images`.
- Duplicate item:
  - Create N new items with same core fields and `spaceId=<spaceId>`.
- Add existing items:
  - For each selected item: set `item.spaceId=<spaceId>`.
- Bulk remove:
  - For each selected item: set `item.spaceId=null`.
- Bulk move:
  - For each selected item: set `item.spaceId=<destinationSpaceId>`.

### Images tab
- Add images:
  - Append uploaded images to `space.images`.
  - Uploads may yield `offline://` placeholders.
- Remove image:
  - Remove image from `space.images` (and clean up orphaned local blobs when relevant).
- Set primary:
  - Set exactly one image in `space.images` to `isPrimary=true`.

### Checklists tab
- Add/edit/delete checklist:
  - Update `space.checklists` as a whole in an atomic local transaction.
- Toggle checklist item checked:
  - Update `space.checklists` with toggled state.
- Add/edit/delete checklist item:
  - Update `space.checklists` with the new array.

### Delete space
- Delete space:
  - Enqueue delete; on success navigate to spaces list.
  - Server-side invariant: clear `item.spaceId` for affected items (or enforce in client + rules).

## UI structure (high level)
- Header:
  - Back
  - Actions menu: Save as Template (admin), Edit, Delete
- Content:
  - Name
  - Notes section
  - Tabs:
    - Items: item list + add existing modal
    - Images: image preview grid + add/remove/set primary
    - Checklists: multiple checklists with inline editing
- Modals:
  - Add existing items picker
  - Delete confirmation
  - Save as template

## User actions → behavior (the contract)
- Switch tabs:
  - Preserve per-tab local state during the session (selected items, draft checklist item input).
- Actions menu:
  - Save as Template:
    - Admin-only.
    - Prefill template form with space name/notes.
    - Normalize checklists so all items are unchecked before save.
  - Edit: navigate to edit screen with `returnTo` preserved.
  - Delete: open confirmation modal; include warning if items exist.
- Checklists inline editing:
  - Commit checklist name on blur/Enter; empty becomes “Checklist”.
  - Commit checklist item text on blur/Enter; Escape cancels; empty becomes “Item”.
  - Toggle check/uncheck persists immediately.

## States
- Loading:
  - Show loading spinner while fetching the space.
- Empty:
  - Images: show “No images uploaded”.
  - Checklists: show “No checklists yet…”.
- Error:
  - Failed fetch shows toast and stays on screen.
  - Failed checklist update rolls back local optimistic edit to previous state.
- Offline:
  - Screen renders from local DB and allows edits; all writes queue.
- Pending sync:
  - Show pending markers where available (space updated, images uploading, checklist update queued).
- Permissions denied:
  - Hide/disallow Save as Template for non-admin; enforce server-side too.

## Media
- Add/select:
  - “Add Images” uses gallery selection.
- Placeholder rendering (offline):
  - `offline://` images render immediately; later resolve to remote URLs.
- Upload progress UX:
  - Show “Uploading images” indicator while selection/upload is in progress.
- Delete semantics:
  - Removing a placeholder image should delete local blob when appropriate.
- Cleanup/orphan rules:
  - Ensure object URLs are revoked (cards) and orphaned blobs are cleaned up when media is removed.

## Collaboration / realtime expectations
- Space updates (images/checklists/name/notes) should appear on other devices on next delta after change-signal bump.
- Assigned items changes should also propagate via delta; do not subscribe to all items.

## Performance notes
- Assigned items may be large; list should be virtualized and support bulk actions efficiently.
- Checklist editing writes full `checklists` arrays; keep them compact and consider conflict strategy.

## Parity evidence
- Space detail structure + tabs + actions menu + modals: `src/pages/SpaceDetail.tsx`
- Assigned items query: `unifiedItemsService.getItemsByProjectAndSpace` usage in `src/pages/SpaceDetail.tsx`
- Add existing items picker: `src/components/spaces/SpaceItemPicker.tsx`
- Media add/remove/primary: `src/pages/SpaceDetail.tsx` + `src/services/spaceService.ts`
- Offline placeholder rendering on cards: `src/components/spaces/SpacePreviewCard.tsx`

