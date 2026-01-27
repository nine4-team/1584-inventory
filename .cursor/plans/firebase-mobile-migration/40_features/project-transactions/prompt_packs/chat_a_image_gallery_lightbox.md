## Prompt Pack — Chat A: Image gallery / lightbox contract

You are helping migrate Ledger to **React Native + Firebase** with an **offline-first** architecture:
- Local SQLite is the source of truth
- Explicit outbox
- Delta sync
- Tiny change-signal doc (no large listeners)

### Goal (this chat)

Write the reusable **image gallery / lightbox** behavior contract so it can be reimplemented in React Native with parity.

### Outputs (required)

Create/update:
- `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`

### Source-of-truth code pointers (parity evidence)

Use these files as the canonical behavior reference:
- `src/components/ui/ImageGallery.tsx`
- `src/pages/TransactionDetail.tsx` (opens the gallery; pin integration; attachment → gallery mapping)

### What to capture (required)

Document the full interaction contract:
- **Entry/exit**
  - What opens the gallery (image tile tap)
  - What closes it (X button, Escape)
  - Escape behavior when zoomed (reset zoom first, then close)
- **Controls**
  - Previous/next image behavior (wrap-around)
  - Zoom in/out step sizes and bounds
  - Reset zoom behavior
  - Pin button semantics (what “pin” means; what callback is invoked)
  - Download/open image behavior
- **Gestures**
  - Pinch-to-zoom
  - Pan while zoomed
  - Double click / double tap zoom toggle (and where it zooms)
  - Mouse wheel zoom (prevent background scroll)
- **UI visibility rules**
  - Auto-hide timing and rules (keep UI visible while zoomed)
  - Tap/click toggles UI visibility (including “suppress click” after drag/pinch)
- **Keyboard behavior**
  - Arrow keys: image nav vs pan when zoomed
  - +/-/0 zoom hotkeys
- **Accessibility expectations**
  - Modal semantics; focus/escape expectations; body scroll locking

### Evidence rule (anti-hallucination)

For each non-obvious behavior, add a short “Observed in …” note pointing to the file/function/handler where it exists.

### Constraints / non-goals

- Don’t do pixel-perfect UI specs; focus on behavior/state.
- Don’t prescribe Firestore listeners; this is purely UI behavior.

