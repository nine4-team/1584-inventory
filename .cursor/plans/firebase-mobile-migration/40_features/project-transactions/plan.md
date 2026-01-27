# Work order: `TransactionDetail` parity contracts

This work order turns the feature map into **implementation-grade specs** by producing the missing “screen contract” detail (the level needed to reproduce Ledger behaviors with the new architecture).

---

## Why this is the next step

`TransactionDetail` is a high-ambiguity screen with:
- Media upload + offline placeholders + deletion semantics
- A reusable lightbox/gallery with zoom/pan/pinch + keyboard controls
- A nested transaction-items list with its own search/filter/sort, selection, bulk ops, merge, and per-item menus

If we don’t capture this behavior explicitly, parity will drift across AI devs/teams.

---

## Output files to produce (first pass)

Create these docs (paths are for the migration doc set, not the app code):

1) `40_features/project-transactions/ui/screens/transaction_detail.md`
2) `40_features/_cross_cutting/ui/components/image_gallery_lightbox.md`
3) `40_features/_cross_cutting/ui/components/transaction_items_list.md`
4) `40_features/_cross_cutting/ui/components/item_preview_card_actions.md`

If conflicts/offline status patterns need explicit definition, also:
- `40_features/_cross_cutting/flows/offline_mutation_lifecycle.md`

---

## Canonical code pointers (parity evidence)

These are the “truth” sources for this work:
- `src/pages/TransactionDetail.tsx`
- `src/components/ui/ImageGallery.tsx`
- `src/components/ui/ImagePreview.tsx` (transaction image preview tile grid + menu hooks)
- `src/components/TransactionItemsList.tsx`
- `src/components/items/ItemPreviewCard.tsx`
- `src/components/items/ItemActionsMenu.tsx`

---

## How to execute (recommended: 2–3 separate AI chats)

Use the copy/paste prompt packs here:
- `40_features/project-transactions/prompt_packs/chat_a_image_gallery_lightbox.md`
- `40_features/project-transactions/prompt_packs/chat_b_transaction_detail_images.md`
- `40_features/project-transactions/prompt_packs/chat_c_transaction_detail_items.md`

### Chat A — Lightbox/gallery contract
Deliverables:
- `image_gallery_lightbox.md`

Must include:
- How an image opens the gallery (tile → modal)
- Close behavior (X, Esc; Esc resets zoom first)
- Controls: prev/next, zoom in/out, reset zoom, pin, download/open
- Gestures: pinch-to-zoom, pan, double-click/double-tap zoom toggle, wheel zoom
- UI auto-hide rules
- Accessibility expectations (focus/escape)

### Chat B — Transaction image sections contract
Deliverables:
- `transaction_detail.md` (Images section)

Must include:
- Receipt images vs other images (both present)
- Upload flows + “uploading” indicators
- Offline placeholders + max image counts
- Delete semantics (local removal, queued deletes, placeholder cleanup)
- Pinning behavior (pinned image layout + how pin/unpin works)

### Chat C — Transaction items section contract
Deliverables:
- `transaction_items_list.md`
- `item_preview_card_actions.md`
- `transaction_detail.md` (Items section, links to cross-cutting docs)

Must include:
- Search/filter/sort specific to the transaction detail’s items section
- Selection UX: select all, per-group select, indeterminate
- Bulk actions + error/pending behavior
- Merge behavior (money aggregation + notes merge)
- Per-item menus and which actions appear in transaction context

---

## Done when (quality gates)

- Each doc includes explicit **states** (loading/empty/error/offline/pending).
- Each non-obvious behavior has **parity evidence** (file + component/function).
- The docs link to the sync engine spec for collaboration behavior constraints (change-signal + delta).

