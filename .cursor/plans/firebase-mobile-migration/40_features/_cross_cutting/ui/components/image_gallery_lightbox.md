# Image gallery / lightbox (shared UI contract)

## What this is
The reusable full-screen image gallery (“lightbox”) used across the app to view images with zoom/pan/pinch, keyboard controls, and optional “pin image” behavior.

## Where it’s used
- Project Transactions:
  - `40_features/project-transactions/ui/screens/TransactionDetail.md`
- Project Items (parity likely; web uses the same gallery component):
  - `src/pages/ItemDetail.tsx` (uses `ImagePreview`/`ImageGallery` patterns)

## Behavior contract

### Open
- Clicking/tapping an image tile opens the gallery modal at that image index.
- The gallery resets view (zoom=1, panX=0, panY=0) when switching images.

### Close
- Clicking the **X** closes the gallery.
- Pressing **Esc**:
  - If zoomed in (\(zoom > 1.01\)), **resets zoom first**.
  - Otherwise closes the gallery.
- The page behind the modal must not scroll while the gallery is open.

### Navigation
- Prev/next buttons appear when there are multiple images.
- Keyboard:
  - **Left/Right** arrows navigate between images (when not zoom-panning).
  - Wrap-around behavior: prev from first → last; next from last → first.

### Zoom + pan
- Zoom controls:
  - Zoom in: `+` / `=`
  - Zoom out: `-` / `_` (disabled at zoom=1)
  - Reset zoom: `0`
- Mouse wheel zoom:
  - Uses a non-passive wheel handler so the modal can call `preventDefault()` (page should not scroll).
  - Zoom is centered around the cursor position (content under cursor stays stable).
- Drag/pan:
  - When zoomed (\(zoom > 1.01\)), drag pans the image.
  - Pan is clamped to bounds (can’t drag the image completely out of view).
- Touch pinch:
  - Two-pointer pinch adjusts zoom and pan to maintain content under the pinch center.
  - Double-tap toggles zoom at the tap point:
    - If zoomed in → reset view
    - Else → zoom to 2x around tap point
- Double click (mouse) toggles zoom at cursor:
  - If zoomed in → reset view
  - Else → zoom to 2x around cursor

### UI auto-hide
- The modal UI auto-hides after ~2.2s of inactivity **only when not zoomed**.
- If zoomed in, keep UI visible to avoid trapping the user without controls.
- Any interaction (mousemove, touchstart, keypress, wheel) should make UI visible.
- Clicking/tapping the modal background toggles UI visibility; a tap after a drag/pinch should restore UI (no accidental close).

### Pin image (optional)
- If the caller provides `onPinToggle`, the gallery shows a **Pin** button.
- Clicking Pin calls back with the currently displayed image.
- “Pinned image” layout/UX is screen-owned (e.g. `TransactionDetail` uses a pinned panel).

## Data + sync notes (if applicable)
- No outbox operations are emitted by the gallery itself; it is a pure UI component.

## Parity evidence
- Gallery modal + controls + keyboard + gestures:
  - Observed in `src/components/ui/ImageGallery.tsx` (`handleKeyDown`, `handlePointer*`, `handleDoubleClick`, `onWheel`, `showUi`).
- Offline placeholder preview resolution (tile grid, not the modal):
  - Observed in `src/components/ui/ImagePreview.tsx` (resolves `offline://` to object URLs via `offlineMediaService.getMediaFile`).
