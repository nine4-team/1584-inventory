## Item-level Dual Tax Amounts — Plan & Rollout

Summary
- Add two separate item-level tax amount fields: `tax_amount_purchase_price` and `tax_amount_project_price`.
- Compute and persist both values from the item prices and `tax_rate_pct`, inheriting `tax_rate_pct` from the transaction when applicable.
- Provide DB safety (backfill + optional trigger) and update app/server and UI to read/write/display the fields.

Data model changes
- Add two columns to `items` table:
  - `tax_amount_purchase_price` TEXT
  - `tax_amount_project_price` TEXT
- Keep existing `tax_amount` column for backward compatibility during rollout.

Calculation rules
- tax_amount_purchase_price = round(purchase_price * (tax_rate_pct / 100), 4) stored as a four-decimal string (e.g., `'12.3456'`).
- tax_amount_project_price = round(project_price * (tax_rate_pct / 100), 4) stored as a four-decimal string.
- Use a consistent rounding strategy (round to 4 decimal places).
- Store tax amounts with 4 decimal places for precision and downstream accounting; **display** values in the UI rounded to 2 decimal places (currency display).

Where to compute
- Primary: application layer (server-side) where items are created/updated (ensures business logic centralization). Rely on the existing inheritance of `tax_rate_pct` from transactions to drive item-level updates.
- (Optional) DB backfill for existing data. We will not add a trigger by default since the app enforces the invariant.

Backend/API changes
- Compute and persist both tax amount fields in:
  - `unifiedItemsService.createItem`
  - `unifiedItemsService.createTransactionItems` (batch)
  - Any item update handler that changes `tax_rate_pct`, `purchase_price`, or `project_price`.
-- Transaction-level tax rate changes should flow to items via the existing inheritance. If that inheritance is functioning, no additional cascade is required.

Frontend/UX
- Display both fields on item forms and lists as derived/read-only values.
- Update displayed values immediately when `tax_rate_pct` or prices change on the client; persist on save.
- If manual override is required later, add explicit override flags and precedence rules.

Backfill / Migration strategy
1. Add columns (nullable) in a migration.
2. Deploy server code that writes computed values on create/update.
3. Run backfill migration to populate the two new columns (batch update).
4. Verify results; then add NOT NULL constraints or defaults if desired.
5. Optionally add a DB trigger to recalculate on direct updates.

Testing
- Unit tests for the tax calculation helper (edge cases, rounding to 4 decimals).
- Integration tests that verify:
  - Item create/update computes both amounts.
  - Backfill populates values correctly.

Audit & monitoring
- Emit audit/log entries whenever `tax_rate_pct` or either `tax_amount_*` changes.
- Monitor backfill and bulk updates for failures and large-volume changes.

Edge decisions to confirm
- Exact column type/scale (we use TEXT to match existing price storage).
- Rounding rules and behavior when prices are NULL/empty.
- Whether `tax_amount` legacy field should be removed or repurposed.

Rollout checklist
- Add migration (columns) → Deploy backend changes → Add backfill → Verify → Add trigger/constraints → Deploy frontend UI.

--- 
If you want, I can now apply the DB migrations and the minimal server changes to compute/persist the fields. The first migration to add columns is included in this commit set.


