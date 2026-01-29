# Spaces — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Spaces list
- [ ] **Route parity**: Spaces list is reachable at `/project/:projectId/spaces`.  
  Observed in `src/utils/routes.ts` (`projectSpaces`) and routing in `src/App.tsx`.
- [ ] **Search**: search filters spaces by name and notes (case-insensitive substring match).  
  Observed in `src/pages/ProjectSpacesPage.tsx` (`filteredSpaces` memo).
- [ ] **Item counts**: each space card displays the count of items whose `item.spaceId === space.id`.  
  Observed in `src/pages/ProjectSpacesPage.tsx` (`itemCountsBySpace` memo).
- [ ] **Empty states**: empty state differentiates between “No spaces yet” vs “No spaces found” when searching.  
  Observed in `src/pages/ProjectSpacesPage.tsx` (conditional empty copy).
- [ ] **No scope label in migration model**: spaces are project-scoped in the target app; the “account-wide” reusable concept is templates, not spaces.  
  **Intentional delta** (treat legacy `space.projectId === null` as non-scope for migration).
- [ ] **Offline image rendering**: if a space image URL is `offline://<id>`, the card resolves and renders the blob via an object URL.  
  Observed in `src/components/spaces/SpacePreviewCard.tsx` (`offlineMediaService.getMediaBlob` + `URL.createObjectURL`).

## Create space
- [ ] **Entry point**: create is launched from the Spaces list “Add” button.  
  Observed in `src/pages/ProjectSpacesPage.tsx` (Add button + `projectSpaceNew` navigation).
- [ ] **Validation**: space name is required.  
  Observed in `src/pages/SpaceNew.tsx` (validation block sets `errors.name`).
- [ ] **Template picker**: user may start from a template; selecting a template prefills name and notes.  
  Observed in `src/pages/SpaceNew.tsx` (template select + prefill effect).
- [ ] **Template checklist normalization**: creating from a template copies checklists but forces all checklist items `isChecked=false`.  
  Observed in `src/pages/SpaceNew.tsx` (`normalizeChecklistsFromTemplate`).
- [ ] **Post-create refresh**: after successful create, refresh project collections (items/transactions/spaces) and close the modal.  
  Observed in `src/pages/SpaceNew.tsx` (`refreshCollections({ includeProject: false })` + `handleClose()`).
- [ ] **Duplicate-name error**: if create fails with a unique constraint error, show “A space with this name already exists”.  
  Observed in `src/pages/SpaceNew.tsx` (error message contains `'unique'`).

## Space detail
- [ ] **Loading state**: shows “Loading space…” spinner while fetching space.  
  Observed in `src/pages/SpaceDetail.tsx` (`isLoading` branch).
- [ ] **Not found**: if space is missing, show “Space not found” and provide Back.  
  Observed in `src/pages/SpaceDetail.tsx` (`!space` branch).
- [ ] **Tabs**: detail has tabs for Items / Images / Checklists.  
  Observed in `src/pages/SpaceDetail.tsx` (tab buttons + `activeTab` state).

## Space detail — Items tab
- [ ] **Assigned items list**: items tab displays items assigned to the space (by `spaceId`) using the itemization UI surface.  
  Observed in `src/pages/SpaceDetail.tsx` (`unifiedItemsService.getItemsByProjectAndSpace` + `TransactionItemsList` render).
- [ ] **Create in-space item defaults**: creating an item in a space defaults `projectPrice` to `purchasePrice` when not set.  
  Observed in `src/pages/SpaceDetail.tsx` (`handleCreateSpaceItem` payload comment).
- [ ] **Add existing items modal**: “Add Existing Items” opens a modal picker where user can search and multi-select items to add.  
  Observed in `src/pages/SpaceDetail.tsx` (`showExistingItemsModal`) and `src/components/spaces/SpaceItemPicker.tsx`.
- [ ] **Select-all**: the picker supports “Select all” for visible items.  
  Observed in `src/components/spaces/SpaceItemPicker.tsx` (`isAllSelected`, `toggleSelectAll`).
- [ ] **Duplicate-group selection**: the picker groups duplicates and supports group selection state.  
  Observed in `src/components/spaces/SpaceItemPicker.tsx` (`CollapsedDuplicateGroup`, `getGroupSelectionState`).
- [ ] **Bulk add selected**: “Add Selected” updates each item with `spaceId = <spaceId>` and shows a success toast.  
  Observed in `src/components/spaces/SpaceItemPicker.tsx` (`handleAddSelected` updates via `unifiedItemsService.updateItem`).
- [ ] **Bulk remove from space**: selecting items and choosing “Remove” clears `item.spaceId`.  
  Observed in `src/pages/SpaceDetail.tsx` (`bulkUnassignSpace` and `bulkAction={{ label: 'Remove' ... }}`).
- [ ] **Bulk move to another space**: selecting items and choosing a different space updates `item.spaceId` to the chosen id.  
  Observed in `src/pages/SpaceDetail.tsx` (`bulkSetSpaceId`).

## Space detail — Images tab
- [ ] **Add images**: user can add multiple images; UI shows “Uploading images” activity.  
  Observed in `src/pages/SpaceDetail.tsx` (`handleAddImage`, `UploadActivityIndicator`).
- [ ] **Remove image**: user can remove an image from the space.  
  Observed in `src/pages/SpaceDetail.tsx` (`handleRemoveImage`, `spaceService.removeSpaceImage`).
- [ ] **Set primary image**: user can set an image as primary.  
  Observed in `src/pages/SpaceDetail.tsx` (`handleSetPrimaryImage`, `spaceService.setSpacePrimaryImage`).
- [ ] **Empty state**: if there are no images, show “No images uploaded”.  
  Observed in `src/pages/SpaceDetail.tsx` (Images tab empty state).
- [ ] **Max images**: space image preview supports up to 20 images.  
  Observed in `src/pages/SpaceDetail.tsx` (`ImagePreview maxImages={20}`).
- [ ] **Offline placeholders**: uploads may create `offline://` placeholder URLs and must render immediately.  
  Observed in `src/pages/SpaceDetail.tsx` (`OfflineAwareImageService.uploadSpaceImage`) and `src/components/spaces/SpacePreviewCard.tsx` (offline URL resolution).

## Space detail — Checklists tab
- [ ] **Add checklist**: “Add Checklist” creates a checklist with default name and persists.  
  Observed in `src/pages/SpaceDetail.tsx` (creates `crypto.randomUUID()` checklist and calls `updateChecklists`).
- [ ] **Edit checklist name**: click name to edit; commit on blur or Enter; empty name becomes “Checklist”.  
  Observed in `src/pages/SpaceDetail.tsx` (`editingChecklistId`, `commitChecklistName`).
- [ ] **Delete checklist**: deleting a checklist persists immediately.  
  Observed in `src/pages/SpaceDetail.tsx` (delete checklist button calls `updateChecklists` with filtered list).
- [ ] **Toggle checklist item**: clicking circle toggles `isChecked` and persists immediately.  
  Observed in `src/pages/SpaceDetail.tsx` (toggle handler calls `updateChecklists`).
- [ ] **Edit checklist item text**: click text to edit; commit on blur or Enter; Escape cancels edit; empty text becomes “Item”.  
  Observed in `src/pages/SpaceDetail.tsx` (`editingItemId`, `commitChecklistItemText`, Escape logic).
- [ ] **Add checklist item**: Enter key or “Add” button adds a new unchecked item and persists.  
  Observed in `src/pages/SpaceDetail.tsx` (`newItemTexts` + add handlers).
- [ ] **Delete checklist item**: remove item action persists immediately.  
  Observed in `src/pages/SpaceDetail.tsx` (remove item button calls `updateChecklists`).

## Edit space
- [ ] **Loads existing**: edit screen fetches the space and pre-fills name/notes.  
  Observed in `src/pages/SpaceEdit.tsx` (`loadSpace`, `setName`, `setNotes`).
- [ ] **Validation**: name is required.  
  Observed in `src/pages/SpaceEdit.tsx` (trim + `errors.name`).
- [ ] **ReturnTo behavior**: navigation respects `returnTo` and falls back to detail or list.  
  Observed in `src/pages/SpaceEdit.tsx` (`getReturnToFromLocation` + `navigateToReturnToOrFallback`).

## Delete space
- [ ] **Delete confirmation**: delete requires explicit confirmation.  
  Observed in `src/pages/SpaceDetail.tsx` (Delete modal).
- [ ] **Warn when items exist**: if space has items, warn that items won’t be deleted; their space assignment will be cleared.  
  Observed in `src/pages/SpaceDetail.tsx` (yellow warning block).
- [ ] **Post-delete navigation**: after delete, navigate back to spaces list.  
  Observed in `src/pages/SpaceDetail.tsx` (`navigate(projectSpaces(projectId!))`).

## Save as template (admin-only)
- [ ] **Admin-only action**: “Save as Template” is shown only for admins.  
  Observed in `src/pages/SpaceDetail.tsx` (`isAdmin` gate in actions menu).
- [ ] **Template name required**: template name is required.  
  Observed in `src/pages/SpaceDetail.tsx` (guard `!templateFormData.name.trim()`).
- [ ] **Template checklist normalization**: saving a space as a template sets all checklist items to unchecked in the saved template.  
  Observed in `src/pages/SpaceDetail.tsx` (`normalizeChecklistsForTemplate`).

## Collaboration (Firebase target)
- [ ] **No large listeners**: mobile app does not attach listeners to large collections (items/spaces).  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.
- [ ] **Change-signal + delta**: while a project is foregrounded, the app listens only to `meta/sync` and runs delta sync on bump.  
  **Intentional delta** required by `40_features/sync_engine_spec.plan.md`.

