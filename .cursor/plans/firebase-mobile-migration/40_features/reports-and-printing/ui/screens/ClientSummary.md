## Intent
Provide a printable/shareable “Client Summary” for a project: overall spend, category breakdown, market value vs spend (“savings”), and an item list with receipt affordances.

## Inputs
- Route params:
  - `projectId` (required)
- Entry points (where navigated from):
  - Project shell → Accounting tab → “Client Summary”

## Reads (local-first)
- Local DB queries:
  - Project by id (name, clientName)
  - Items for project
  - Transactions for project (for receipt link resolution and category attribution fallback)
  - Budget categories (for id → name mapping)
  - Business profile (logo + name)
- Derived view models:
  - `totalSpent`: sum of item `projectPrice`
  - `totalMarketValue`: sum of item `marketValue`
  - `totalSaved`: sum of `marketValue - projectPrice` when `marketValue > 0`
  - `categoryBreakdown`: group item prices by attributed budget category
  - `receiptLink(item)`: internal invoice link OR external receipt URL OR none

## Writes (local-first)
- None (read-only report).

## UI structure (high level)
- Action bar: Back + Share/Print
- Header: logo (if available), “Client Summary”, project name/client name, date
- Empty state: “No items found”
- Summary cards:
  - Project overview (total spent + category breakdown)
  - Furnishing savings (market value, what you spent, what you saved)
- Item list (“Furnishings”): item description, source, receipt link affordance, space label, price + footer total

## User actions → behavior (the contract)
- Tap Back:
  - Use native back stack; fallback target is project items list for this project.
  - Web parity evidence: `src/pages/ClientSummary.tsx` (`fallback = projectItems(...)`, `getBackDestination`).
- Tap Share/Print:
  - Web parity uses `window.print()`.
  - Mobile requirement: share/print via native flows using a rendered artifact derived from local state.
- Tap “View Receipt” in item list:
  - If the item’s linked transaction is canonical (`INV_*`) OR invoiceable by reimbursement type, navigate to project invoice report.
  - Else, if the transaction has a receipt image URL, open it externally.
  - Else, no receipt link is shown.
  - Parity evidence: `src/pages/ClientSummary.tsx` (`getReceiptLink`) and item list rendering.

## States
- Loading: show “Loading client summary…” while queries/derived model resolve.
  - Parity evidence: `src/pages/ClientSummary.tsx` loading block.
- Empty: show “No items found” if there are no items for the project.
  - Parity evidence: `src/pages/ClientSummary.tsx`.
- Error: show error state + Back button.
  - Parity evidence: `src/pages/ClientSummary.tsx` error block.
- Offline: must render from local DB; if categories are missing locally, category breakdown may show “Uncategorized”/unknown name until metadata is present.
- Pending sync: if business logo or other referenced media is pending upload, show a non-blocking warning that exports may omit branding/media.

## Collaboration / realtime expectations
- No realtime requirement while open.
- Values reflect local DB until the next delta sync run.

## Performance notes
- Item list can be large; use list virtualization and avoid expensive derived recomputation on every render.
- Category breakdown should be computed from pre-joined item→attribution selectors (avoid repeated `transactions.find(...)` in hot loops).

## Parity evidence
- Summary math + receipt link rule: `src/pages/ClientSummary.tsx`
- Category name mapping via `useCategories`: `src/components/CategorySelect.tsx`
- Entry routes: `src/pages/ProjectLayout.tsx`, `src/utils/routes.ts`

