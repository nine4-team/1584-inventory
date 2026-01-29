# Reports + share/print — Acceptance criteria (parity + Firebase deltas)

Each non-obvious criterion includes **parity evidence** (web code pointer) or is labeled **intentional delta** (Firebase mobile requirement).

## Report entrypoints
- [ ] **Accounting tab links to all reports**: project shell exposes links to Invoice, Client Summary, and Property Management Summary.
  Observed in `src/pages/ProjectLayout.tsx` (uses routes `projectInvoice`, `projectClientSummary`, `projectPropertyManagementSummary` from `src/utils/routes.ts`).

## Invoice (`ProjectInvoice`)
- [ ] **Invoiceable transaction selection**: includes only transactions where:
  - `status !== 'canceled'`, and
  - `reimbursementType ∈ {CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT}`.
  Observed in `src/pages/ProjectInvoice.tsx` (`invoiceableTransactions`).
- [ ] **Charges vs credits sections**: splits invoice lines into “Project Charges” (client owes company) and “Project Credits” (company owes client).
  Observed in `src/pages/ProjectInvoice.tsx` (`clientOwesLines`, `creditLines`).
- [ ] **Per-transaction itemization and totals**:
  - If the transaction has linked items, the line total is the sum of linked items’ `projectPrice`.
  - Missing/blank item `projectPrice` is flagged and contributes \(0\).
  - If there are no linked items, line total uses `transaction.amount`.
  Observed in `src/pages/ProjectInvoice.tsx` (`invoiceLines`, `missingPrice`, `lineTotal`).
- [ ] **Sorting by date**: within Charges and Credits, lines are sorted ascending by `transaction.transactionDate`.
  Observed in `src/pages/ProjectInvoice.tsx` (`sort((a,b)=>...)`).
- [ ] **Canonical title mapping**: canonical inventory transactions (`INV_SALE_*`, `INV_PURCHASE_*`) display canonical titles, otherwise show transaction source.
  Observed in `src/pages/ProjectInvoice.tsx` (`getCanonicalTransactionTitle`).
- [ ] **Totals displayed**: Charges Total, Credits Total, and Net Amount Due \(=\) charges − credits.
  Observed in `src/pages/ProjectInvoice.tsx` (`clientOwesSubtotal`, `creditsSubtotal`, `netDue`).
- [ ] **Empty state**: when no invoiceable lines exist, shows “No invoiceable items” state.
  Observed in `src/pages/ProjectInvoice.tsx` (`!hasAnyLines` block).

## Client summary (`ClientSummary`)
- [ ] **Project overview totals**:
  - Total spent overall = sum of `item.projectPrice`.
  - Market value = sum of `item.marketValue`.
  - Saved = sum of `(marketValue - projectPrice)` only when `marketValue > 0`.
  Observed in `src/pages/ClientSummary.tsx` (the `summary` memo).
- [ ] **Category breakdown uses canonical attribution model**:
  - Items are attributed by `item.inheritedBudgetCategoryId` when present.
  - Fallback: for legacy/non-canonical cases, items can be attributed by their linked transaction’s `category_id`.
  - Canonical inventory transactions are supported even when `transaction.category_id` is null/meaningless.
  Source of truth: `00_working_docs/BUDGET_CATEGORIES_CANONICAL_TRANSACTIONS_REVISIONS.md` and `40_features/project-items/flows/inherited_budget_category_rules.md`.
  **Intentional delta** vs web: web groups by transaction `categoryId` only (`src/pages/ClientSummary.tsx`).
- [ ] **Receipt link behavior per item**:
  - If item has `transactionId` and the transaction is canonical (`INV_*`) or invoiceable by reimbursement type, “View Receipt” links to the project invoice report.
  - Else, if transaction has `receiptImages[0].url`, link to the external receipt URL.
  - Else, no receipt link.
  Observed in `src/pages/ClientSummary.tsx` (`getReceiptLink`) and item list rendering.
- [ ] **Empty state**: if there are no items, shows a “No items found” empty state.
  Observed in `src/pages/ClientSummary.tsx`.

## Property management summary (`PropertyManagementSummary`)
- [ ] **Summary totals**:
  - Total Items = item count
  - Total Market Value = sum of `item.marketValue`
  Observed in `src/pages/PropertyManagementSummary.tsx` (`totalMarketValue`, `items.length`).
- [ ] **Item list fields**: renders item description, source, sku, space/location (when present), and market value.
  Observed in `src/pages/PropertyManagementSummary.tsx` (item list markup).
- [ ] **Missing market value messaging**: when market value is \(0\), shows “No market value set”.
  Observed in `src/pages/PropertyManagementSummary.tsx` (`marketValue === 0` block).
- [ ] **Empty state**: if there are no items, shows a “No items found” empty state.
  Observed in `src/pages/PropertyManagementSummary.tsx`.

## Share/print (mobile adaptation)
- [ ] **Share/print affordance exists on each report**.
  Web parity evidence: `src/pages/{ProjectInvoice,ClientSummary,PropertyManagementSummary}.tsx` (Print button + `window.print()`).
  **Intentional delta**: mobile uses share/print APIs rather than browser print.
- [ ] **Works offline**: reports generate from local DB with no network required.
  **Intentional delta** required by local-first invariant in `40_features/sync_engine_spec.plan.md`.
- [ ] **Media pending upload warning**: if business logo (or other referenced media) is `local_only`/`uploading`/`failed`, show a non-blocking warning that exported output may be missing branding/media.
  **Intentional delta** (mobile/offline media lifecycle requirement).

