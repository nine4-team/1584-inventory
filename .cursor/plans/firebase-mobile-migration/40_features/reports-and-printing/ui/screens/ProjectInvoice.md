## Intent
Generate a printable/shareable invoice for a project by summarizing invoiceable transactions into Charges and Credits, with itemized lines when items are linked to transactions.

## Inputs
- Route params:
  - `projectId` (required)
- Entry points (where navigated from):
  - Project shell → Accounting tab → “Invoice”
  - Client Summary → “View Receipt” (internal link can target invoice)

## Reads (local-first)
- Local DB queries:
  - Project by id (name, clientName)
  - Transactions for project:
    - filter `status != canceled`
    - filter `reimbursementType ∈ {CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT}`
  - Items for project:
    - join/group by `item.transactionId`
  - Business profile:
    - `businessName`, `businessLogoUrl` (and logo media status if tracked)
- Derived view models:
  - `invoiceLines`: per transaction, a list of linked item lines + computed `lineTotal`
  - `chargesLines`, `creditsLines`, subtotals, net due

## Writes (local-first)
- None (read-only report).
- Share/print/export is not a data write; it creates a derived artifact for sharing.

## UI structure (high level)
- Action bar: Back + Share/Print
- Header: logo (if available), “Invoice”, project name/client name, date
- Empty state: “No invoiceable items”
- Charges section: list of invoice lines + subtotal
- Credits section: list of invoice lines + subtotal
- Net due section

## User actions → behavior (the contract)
- Tap Back:
  - Use native back stack; fallback target is project transactions list for this project.
  - Web parity evidence: `src/pages/ProjectInvoice.tsx` (`defaultBackTarget = projectTransactions(...)`, `getBackDestination`).
- Tap Share/Print:
  - Web parity uses `window.print()`.
  - Mobile requirement: open native share/print flow (implementation-dependent) using a rendered report artifact derived from local state.
- View invoice lines:
  - Each line shows canonical title mapping when transaction id is `INV_SALE_*`/`INV_PURCHASE_*`, otherwise shows source.
  - Each line shows date + notes (when present).
  - If items exist for the transaction, render item sub-lines and “Missing project price” badges where applicable.

## States
- Loading: show “Building invoice…” state until local queries/derived model are ready.
  - Parity evidence: `src/pages/ProjectInvoice.tsx` loading block.
- Empty: show “No invoiceable items” when there are no charges or credits lines.
  - Parity evidence: `src/pages/ProjectInvoice.tsx` (`!hasAnyLines` block).
- Error: show error state + Back button.
  - Parity evidence: `src/pages/ProjectInvoice.tsx` error block.
- Offline: must render from local DB; if project data missing locally, treat as empty/error depending on why.
- Pending sync: if business logo or other referenced media is pending upload, show a non-blocking warning that exported output may omit branding/media.

## Media (if applicable)
- Business logo:
  - Render if available.
  - If logo is `local_only` / `uploading` / `failed`, indicate in UI (non-blocking) so user understands why exports may differ.

## Collaboration / realtime expectations
- No realtime requirement while the report is open.
- Accept that values reflect local DB until the next delta sync run.

## Performance notes
- Expected project size: potentially large transaction + item lists; invoice only includes invoiceable transactions.
- Ensure per-transaction item grouping is efficient (avoid \(O(n^2)\) scans when possible; use pre-grouped maps keyed by `transactionId`).

## Parity evidence
- Invoice selection + line computation + totals: `src/pages/ProjectInvoice.tsx`
- Entry routes: `src/pages/ProjectLayout.tsx`, `src/utils/routes.ts`

