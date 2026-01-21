# Pinned Receipt Viewer (Split-Screen) Plan

## Goal
Enable users to **view a receipt/attachment while actively editing/adding items** on the transaction screen.

- **Mobile**: pin the receipt viewer to the **top half** or **bottom half** of the screen (user selectable).
- **Desktop**: pin the receipt viewer to the **side** of the screen (typically: right side), while the transaction detail and item forms remain usable.
- Preserve the existing **full-screen image gallery** experience as an optional “open fullscreen” action.

## Current State (Baseline)
- Transaction receipts are rendered via `TransactionImagePreview` in `src/pages/TransactionDetail.tsx`.
- Tapping an image opens `src/components/ui/ImageGallery.tsx`, which is a **full-screen modal** (`fixed inset-0`) and disables page scrolling (`document.body.style.overflow = 'hidden'`).
- The modal blocks interaction with the transaction detail form/items list while open.

## Proposed UX
### Mobile
- When “Pinned mode” is enabled, show a **docked viewer** consuming ~50% of the viewport height:
  - **Pinned top**: viewer on top, form on bottom.
  - **Pinned bottom**: form on top, viewer on bottom.
- Add controls:
  - **Pin toggle** (on/off)
  - **Position** selector (top/bottom) when pinned
  - **Fullscreen** button to open the existing modal gallery
  - **Close** button to hide the pinned viewer

### Desktop
- When pinned, show a split layout:
  - Receipt viewer pinned to **right side** (~35–45% width), transaction UI on left.
  - Optional: allow switching left/right later; start with a single default to reduce scope.

## High-Level Technical Approach
### Key idea
Introduce a **non-modal** viewer component that renders **inside** the transaction page layout (not `fixed inset-0`), so the rest of the UI remains interactive.

We will **reuse** image rendering/controls behavior from `ImageGallery` where possible, but in a container-based “docked” mode.

## Component Plan
### 1) New component: `DockedImageGallery` (recommended)
Create `src/components/ui/DockedImageGallery.tsx` (name flexible) with these properties:

- **Inputs**
  - `images: ItemImage[]` (same shape used by `ImageGallery`)
  - `initialIndex?: number`
  - `onClose?: () => void` (close/hide docked viewer)
  - `onOpenFullscreen?: (index: number) => void` (open existing modal gallery)
  - `mode: 'docked'` (future-proof if we later unify)
- **Behavior**
  - Supports:
    - next/prev navigation
    - pinch-to-zoom + pan
    - zoom in/out/reset controls
  - Must NOT:
    - set `document.body.style.overflow`
    - intercept scrolling outside its container

Implementation strategy:
- Extract the shared “image interaction logic” from `ImageGallery` into a hook (e.g. `useImagePanZoom`) used by both modal + docked, OR duplicate initially to reduce risk and refactor later.
  - **Preferred**: a hook to avoid a forked UX, but it’s more upfront work.
  - **Pragmatic**: copy/paste minimal subset first, then refactor once pinned mode is stable.

### 2) Pinned layout wrapper: `PinnedReceiptPanel`
Add a lightweight layout component (in `TransactionDetail` or extracted to `src/components/transactions/`):

- Receives:
  - `isPinned: boolean`
  - `pinPlacement: 'top' | 'bottom' | 'right'` (desktop uses right)
  - `viewer: ReactNode`
  - `content: ReactNode` (the rest of the transaction UI)

This keeps `TransactionDetail` readable and makes it easier to reuse later in edit/add flows.

## State + Persistence
### UI State (per device)
Persist to local storage to avoid surprising resets:

- `receiptViewer.pinned`: boolean
- `receiptViewer.placement.mobile`: `'top' | 'bottom'`
- `receiptViewer.placement.desktop`: `'right'` (single value initially)
- Optional: `receiptViewer.lastOpenIndex`: number

Where to store:
- Simple: `localStorage` (fast, no backend).
- Later: per-account preference in DB if we want settings to roam across devices.

## TransactionDetail Integration
### Where changes happen
`src/pages/TransactionDetail.tsx` will:

- Keep the existing `TransactionImagePreview` grid (thumbs + add/remove).
- Add a “Pin receipt” affordance near the Receipts header (and/or within the thumb grid menu).
- When a receipt thumbnail is tapped:
  - If pinned mode ON: set the pinned viewer’s `currentIndex` and open pinned panel (if not visible).
  - If pinned mode OFF: open existing full-screen `ImageGallery` (current behavior).

### Image source considerations
`TransactionDetail` currently builds `galleryTransactionImages` from:
- `transaction.receiptImages` + `transaction.otherImages`
- filters to renderable images for gallery

Pinned viewer should use the **same filtered list** so behavior matches the modal.

### PDF attachments
Receipts may include PDFs. Today:
- `TransactionImagePreview` detects PDFs and opens in a new tab.
Pinned viewer should:
- Only render images (same filter) and show a small “This receipt is a PDF” placeholder if the selected attachment is not image-renderable.
- Provide an “Open file” action for PDFs.

## Layout + CSS Strategy
### Mobile split-screen
Implement using a viewport-height container:

- Outer container: `h-[calc(100vh-<header>)]` if needed, or use `min-h-screen` + `sticky` patterns carefully.
- When pinned:
  - Use a flex column:
    - viewer: `h-[50vh]` (or `flex-[0_0_50%]`)
    - content: `flex-1 min-h-0 overflow-auto`
  - Ensure inner scroll containers don’t fight:
    - viewer container: `touch-action: none` only inside image area (like today)
    - content area: normal scroll

### Desktop side-by-side
Use responsive classes:

- `lg:flex lg:flex-row`
- left content: `lg:flex-1 lg:min-w-0`
- right viewer: `lg:w-[40%] lg:max-w-[560px]` (tune)
- Both panes: `min-h-0` + independent scrolling as needed.

## Accessibility / Interaction Notes
- Ensure keyboard access:
  - pinned viewer: arrow keys for prev/next, +/- for zoom, Esc closes pinned viewer (optional: Esc resets zoom first as in modal).
- Ensure focus management:
  - In pinned mode, do NOT trap focus like a modal.
  - Fullscreen modal should keep existing role/aria semantics.

## Implementation Steps (Suggested Order)
1. **Add pinned viewer state** (pinned on/off, placement, last index) in `TransactionDetail`.
2. **Create `DockedImageGallery`** with basic image display + next/prev + zoom/pan.
3. **Add UI controls** in the Receipts section:
   - toggle pinned
   - choose top/bottom (mobile only)
   - open fullscreen
4. **Integrate thumbnail click behavior**:
   - pinned: open docked viewer + set index
   - not pinned: open existing `ImageGallery` modal
5. **Responsive layout wiring** in `TransactionDetail`:
   - mobile: top/bottom split
   - desktop: right side split
6. **Edge cases**:
   - no receipts
   - only PDFs
   - offline `offline://` URLs (ensure we pass resolved URLs where needed)
7. **Polish + refactor**:
   - optional: extract shared pan/zoom hook from modal and reuse in docked to reduce drift.

## Testing Plan
### Manual
- Mobile (iOS Safari, Android Chrome):
  - pin top/bottom, scroll items list while receipt is visible
  - zoom/pan receipt without scrolling the page accidentally
  - add/update items while pinned viewer is open
  - open fullscreen from pinned mode and return
- Desktop (Chrome/Safari):
  - pinned on right, resize window, ensure no overflow issues
  - keyboard shortcuts still work in both modes
- Attachments:
  - image receipt(s)
  - PDF receipt(s) (open file)
  - offline placeholders (`offline://...`) render correctly

### Automated (optional / follow-up)
- Component tests for `DockedImageGallery` controls and rendering.
- E2E smoke test (if present) for toggling pin and adding an item while pinned.

## Rollout / Risk Management
- Start with **TransactionDetail** only (highest value).
- Later extend to:
  - `src/pages/EditTransaction.tsx`
  - `src/pages/AddTransaction.tsx`
  - item-level edit flows if receipts are visible there

Primary risks:
- Mobile scroll/gesture conflicts (fixable with careful containment + `touch-action`).
- UX drift between docked viewer and fullscreen modal if we fork logic (mitigate by extracting a shared hook after initial success).

