# Business inventory tx cards vs project tx cards (diffs)

Goal: bring **business inventory transaction list cards** into closer parity with **project transaction list cards**.

Sources:
- Project transaction list cards: `src/pages/TransactionsList.tsx`
- Business inventory transaction list cards: `src/pages/BusinessInventory.tsx`

## Card UI/UX differences

### Primary badge (top-right / most prominent)
- **Project**: shows **transaction type** badge (e.g. Purchase / Sale / Return / To Inventory).
- **Business inventory**: shows **status** badge (Completed / Pending / Canceled).

### Other badges on the card
- **Project**:
  - Budget category badge (when available).
  - Review/completeness signaling:
    - `Needs Review` (if `needsReview === true`), otherwise
    - `Missing Items` (when completeness is not complete).
- **Business inventory**:
  - No type/category/review/completeness badges shown on the card today.

### Details row (the “metadata line”)
- **Project**: **Amount • Payment method • Date**
- **Business inventory**: **Amount • (Project name if present) • Date**
  - Payment method is not displayed on the card.

### Amount shown
- **Project**: may show a **computed total** for canonical inventory sale/purchase transactions (instead of raw stored `amount`).
- **Business inventory**: shows stored `transaction.amount`.

### Badge placement + sizing
- **Project**: badges live in a **bottom “badge row”**; small chips (text-xs).
- **Business inventory**: badge is in the **header row (top-right)** and is **larger** (text-sm, extra padding).

### Container / spacing
- **Project list container**: standard inset within the page layout.
- **Business inventory list container**: uses `-mx-6` for a more “full bleed” feel relative to the surrounding content.

## List-level UX differences (things around the cards)

### Add / import / export
- **Project**:
  - Has an add menu that includes **Import Invoice** options.
  - Has **Export CSV**.
- **Business inventory**:
  - Has **Add Transaction**.
  - No import/export controls in the transaction list UI today.

### Search
- **Project**: placeholder focuses on source/amount; smaller input (text-sm).
- **Business inventory**: broader placeholder (source/type/project/notes/amount); larger input (text-base) and inside a sticky header section.

### Filter “signal” on the card
- **Project**: surfaces “review-ness” directly on each card via badges (`Needs Review` / `Missing Items`).
- **Business inventory**: supports filtering by type/category/review/etc, but the card UI does not surface most of those attributes.

## First parity step (recommended)

Replace the **business inventory status badge** (Completed/Pending/Canceled) with the **transaction type badge** (Purchase/Return/etc).

Status:
- Done in `src/pages/BusinessInventory.tsx` (business inventory transaction cards now show the type chip).

If status still needs to be visible after that, a parity-friendly follow-up is:
- Move status into a **bottom badge row** (same pattern as project cards) instead of being the headline badge.

