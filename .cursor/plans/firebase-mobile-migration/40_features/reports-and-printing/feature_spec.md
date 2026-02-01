# Reports + share/print — Feature spec (Firebase mobile migration)

## Intent
Provide an offline-first reporting experience within a project: users can generate an invoice and two project summaries from local data, then share/print those reports on mobile. Reports should be correct relative to local state (SQLite), and may be “stale” relative to remote until the next delta run (collaboration is not realtime-critical here).

## Owned screens / routes
- `ProjectInvoice` (`/project/:projectId/invoice`)
  - Web parity source: `src/pages/ProjectInvoice.tsx`
- `ClientSummary` (`/project/:projectId/client-summary`)
  - Web parity source: `src/pages/ClientSummary.tsx`
- `PropertyManagementSummary` (`/project/:projectId/property-management-summary`)
  - Web parity source: `src/pages/PropertyManagementSummary.tsx`

Screen contracts:
- `ui/screens/ProjectInvoice.md`
- `ui/screens/ClientSummary.md`
- `ui/screens/PropertyManagementSummary.md`

## Inputs (entities)
Reports read from local DB (SQLite) only:
- Project: `projects`
- Transactions: `transactions`
- Items: `items`
- Spaces: `spaces` (for space/location labels in PM summary)
- Budget categories: `budget_categories` (category name lookup for client summary breakdown)
- Business profile: `business_profile` (logo + name)

Firebase migration constraint:
- Reports must not attach listeners to large collections. They render from local DB; background convergence is owned by the sync engine (`meta/sync` change-signal + delta).

## Canonical vs non-canonical attribution (required)
This feature must align with:
- `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md`
- `40_features/project-items/flows/inherited_budget_category_rules.md`

Rule (required):
- Budget/category attribution for reporting must support **item-driven attribution** (via `item.inheritedBudgetCategoryId`), especially for canonical inventory transactions where `transaction.category_id` is null/meaningless.

## Primary flows

### 1) Open a report from a project
Entry points (web parity):
- From `ProjectLayout` → Accounting view → report buttons:
  - `projectInvoice(projectId)`
  - `projectClientSummary(projectId)`
  - `projectPropertyManagementSummary(projectId)`
  - Evidence: `src/pages/ProjectLayout.tsx`, `src/utils/routes.ts`

Mobile navigation rule:
- Back behavior uses native back stack; only use `backTarget` fallback for deep links/cold starts (see `40_features/navigation-stack-and-context-links/README.md`).

### 2) Invoice
Behavior summary (parity + required clarifications):
- Invoice lines are derived from **invoiceable transactions**:
  - Exclude `status === 'canceled'`
  - Include only transactions with `reimbursementType ∈ {CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT}`
  - Evidence: `src/pages/ProjectInvoice.tsx` (`invoiceableTransactions` filter)
- Invoice groups into two sections:
  - **Project Charges**: `reimbursementType === CLIENT_OWES_COMPANY`
  - **Project Credits**: `reimbursementType === COMPANY_OWES_CLIENT`
  - Evidence: `src/pages/ProjectInvoice.tsx` (`clientOwesLines`, `creditLines`)
- For each invoiceable transaction, compute a line total:
  - If the transaction has **linked items** (`item.transactionId === transaction.transactionId`), line total is the sum of linked items’ `projectPrice`.
    - If an item has missing/blank `projectPrice`, it is flagged as “Missing project price” and contributes \(0\) to the sum.
  - If there are **no linked items**, line total uses `transaction.amount`.
  - Evidence: `src/pages/ProjectInvoice.tsx` (`invoiceLines` mapping; `missingPrice` and `lineTotal`)
- Sorting:
  - Charges and credits are each sorted ascending by `transaction.transactionDate` (string compare).
  - Evidence: `src/pages/ProjectInvoice.tsx` (`sort((a,b)=>...)`)
- Canonical title mapping (display):
  - If `transaction.transactionId` starts with `INV_SALE_` or `INV_PURCHASE_`, display canonical titles; else display `transaction.source`.
  - Evidence: `src/pages/ProjectInvoice.tsx` (`getCanonicalTransactionTitle`)
- Totals:
  - Show Charges Total, Credits Total, and Net Amount Due \(=\) charges − credits.
  - Evidence: `src/pages/ProjectInvoice.tsx` (`clientOwesSubtotal`, `creditsSubtotal`, `netDue`)

### 3) Client summary
Behavior summary (parity + required deltas for canonical attribution):
- Computes summary rollups from items:
  - **Total spent overall**: sum of `item.projectPrice` across project items.
  - **Market value**: sum of `item.marketValue`.
  - **Saved**: for items with `marketValue > 0`, sum of `marketValue - projectPrice`.
  - Evidence: `src/pages/ClientSummary.tsx` (the `summary` memo)
- Category breakdown:
  - Web parity computes category breakdown by mapping each item to its transaction’s `transaction.categoryId` (if present), then grouping by **category name**.
  - Evidence: `src/pages/ClientSummary.tsx` (`transactionCategoryMap`, `categoryBreakdown`)
  - **Required delta (canonical attribution model)**:
    - For each item, determine an attributed category id using:
      - `item.inheritedBudgetCategoryId` when present (preferred), else
      - the linked transaction’s `category_id` if present (fallback for legacy/non-canonical cases).
    - Group items by the attributed category id (and resolve to category name via cached categories).
    - Canonical transactions must participate via `inheritedBudgetCategoryId` (they may not have a meaningful `category_id`).
- Receipt link rule (per item):
  - If item has a `transactionId`, attempt to find that transaction.
  - If the transaction is canonical by id prefix (`INV_SALE_`/`INV_PURCHASE_`) **or** invoiceable by reimbursement type, the “receipt” link points to the **project invoice** screen.
  - Else, if the transaction has a receipt image URL (`tx.receiptImages?.[0]?.url`), link to that URL.
  - Else, no receipt link.
  - Evidence: `src/pages/ClientSummary.tsx` (`getReceiptLink`)

### 4) Property management summary
Behavior summary (parity):
- Shows a summary:
  - total item count
  - total market value (sum of `item.marketValue`)
  - Evidence: `src/pages/PropertyManagementSummary.tsx` (`totalMarketValue`)
- Shows an item list containing (at least):
  - item description
  - item source and sku when present
  - item space/location label when present
  - item market value and “No market value set” when \(0\)
  - Evidence: `src/pages/PropertyManagementSummary.tsx` (item list markup)

## Share/print (mobile adaptation)
Web parity uses `window.print()` and print-only CSS classes.
- Evidence: `src/pages/{ProjectInvoice,ClientSummary,PropertyManagementSummary}.tsx` (`handlePrint`)

Mobile requirement (intentional delta):
- Reports must be shareable/printable via native mechanisms (share sheet / print dialog) without depending on a browser print API.
- The exported artifact should be derived from local data and must work offline.

## Offline-first behavior (mobile target)
- Reports render from local DB offline (no network required).
- If business profile logo or other referenced media is `local_only` / `uploading` / `failed`, the report must indicate this (at minimum: a non-blocking warning that branding/media may be missing in shared output).
- Reconnect behavior: reports may remain stale until the next delta run; a “last updated” indicator is recommended but not required unless used elsewhere globally.

## Collaboration expectations
- Reports do not require realtime updates while open.
- Foreground refresh is optional; correctness is relative to local DB.

