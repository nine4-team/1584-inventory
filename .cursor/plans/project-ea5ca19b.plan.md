---
name: Generate Invoice from Accounting Tab (Projects)
overview: ""
todos:
  - id: 2a12a668-682b-4a3e-bbc2-2d30ac0a9144
    content: Add /project/:id/invoice route in src/App.tsx
    status: completed
  - id: 9b7c30e8-4f4e-446b-ac79-17d8f8bdc822
    content: Add Generate Invoice button in ProjectDetail accounting tab
    status: completed
  - id: 7f455110-e3fe-494f-b7fe-1866f83906a3
    content: Create ProjectInvoice.tsx to fetch, group, and render invoice
    status: completed
  - id: 247fdd96-d30b-4d12-9ceb-6ab545834401
    content: Use Intl.NumberFormat for USD currency formatting
    status: completed
  - id: 060c5b25-33db-4a7d-8698-221760459afe
    content: Flag items missing project_price and treat as $0
    status: completed
  - id: 1e6e3784-97f7-435f-9579-7c681ba50f52
    content: Validate subtotals and net total with sample data
    status: pending
isProject: false
---

# Generate Invoice from Accounting Tab (Projects)

### Overview

Add a single "Generate Invoice" button in the `ProjectDetail` Accounting tab. Clicking it opens a new invoice page that compiles all transactions with `reimbursement_type` of "Client Owes" or "We Owe" (excluding canceled), groups itemized transactions under their parent transaction, shows subtotals for both sides, and a net total due. The invoice is a simple HTML page styled with existing Tailwind patterns and ready to print.

### Data Selection and Grouping

- Include transactions where:
  - `reimbursement_type` ∈ {"Client Owes", "We Owe"}
  - `status` ≠ "canceled"
- Group into two sections:
  - Client Owes: `reimbursement_type === 'Client Owes'`
  - Credits (We Owe): `reimbursement_type === 'We Owe'`
- For each transaction (in both sections):
  - Fetch items by `unifiedItemsService.getItemsForTransaction(projectId, transactionId)`.
  - If items exist: render each item as a sub-line using `item.project_price`.
  - If items do not exist: render the transaction as a single line item using `transaction.amount`.
  - If an item lacks `project_price`, show a visible note (e.g., “Missing project price”) and treat as $0 in section totals.

### Calculations

- Client Owes Subtotal = sum over all Client Owes transactions:
  - If items exist → sum of each item `project_price` (0 when missing)
  - Else → `parseFloat(transaction.amount)`
- Credits Subtotal = sum over all We Owe transactions (same rules as above)
- Final Amount Due = Client Owes Subtotal − Credits Subtotal
- Sorting: list transactions by `transaction_date` ascending within each section.
- Format with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.

### UI Changes

- `src/pages/ProjectDetail.tsx` (Accounting tab content):
  - Add a single primary `Button` labeled "Generate Invoice" above or to the right of the summary cards.
  - On click: navigate to `/project/:id/invoice`.
  - Use existing `Button` from `src/components/ui/Button.tsx` for consistent styling.
  - Example new code (conceptual):
```tsx
<Button onClick={() => navigate(`/project/${project.id}/invoice`)}>
  Generate Invoice
</Button>
```


### Routing

- `src/App.tsx`:
  - Add a new route: `<Route path="/project/:id/invoice" element={<ProjectInvoice />} />`.

### New Component: `ProjectInvoice.tsx`

- Location: `src/pages/ProjectInvoice.tsx`.
- Responsibilities:
  - Read `projectId` from route params; fetch project via `projectService.getProject(id)`.
  - Fetch transactions via `transactionService.getTransactions(id)` and filter by rules above.
  - For each included transaction, fetch items in parallel with `Promise.all` using `unifiedItemsService.getItemsForTransaction(id, tx.transaction_id)`.
  - Build two arrays: clientOwesLines[], creditLines[] with nested items if present.
  - Compute subtotals and net total.
  - Render a print-friendly HTML layout:
    - Header: Project name, client name, invoice date.
    - Section: Client Owes (transactions and optional item sub-lines) + subtotal.
    - Section: Credits (We Owe) + subtotal.
    - Footer: Net Amount Due.
  - Provide a small top-right action bar with "Back" and "Print" (optional) using existing `Button`.

### Styling and Output

- Use existing Tailwind classes and `Button` component for visual consistency.
- Keep markup print-friendly (minimize non-essential UI; hide action bar in print via CSS if desired).

### Edge Cases & Behavior

- No qualifying transactions: show a friendly “No invoiceable items” state.
- Missing `project_price`: show an inline warning per item and exclude from the item sum (count as $0) so you can adjust later.
- If a transaction has both items and a transaction-level amount, only the item totals are used (transaction amount is ignored in this case) to avoid double-counting.

### Testing Steps

- Create data with:
  - Client Owes (with items and without items)
  - We Owe (with items and without items)
  - One canceled transaction (should not appear)
  - An item missing `project_price` (should be flagged and counted as $0)
- Verify subtotals and net total match manual calculations.
- Confirm the button navigates correctly and the page prints cleanly.