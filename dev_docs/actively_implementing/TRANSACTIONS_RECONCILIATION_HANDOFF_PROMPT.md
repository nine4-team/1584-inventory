## Prompt for AI dev: finish Transactions reconciliation (REQUIRED)

### Goal
Implement/produce the **Transactions reconciliation** described in `dev_docs/actively_implementing/DATA_RECONCILIATION_PROMPT_MISSING_SYNC.md` (section “Transactions (REQUIRED for full reconciliation)” + “Transaction reconciliation (REQUIRED)”).

Constraints / requirements (must follow)
- **Compare exported local transactions vs server `public.transactions`** for a given `accountId`.
- Report must include:
  - `localOnlyTransactions`, `serverOnlyTransactions`
  - per-transaction **scalar field diffs** after normalization (avoid false positives)
  - per-transaction **`itemIds` membership diffs**:
    - treat arrays as sets (order-insensitive)
    - **canonical `I-...` IDs only**
- **Dry-run only** by default. **No DB writes**.
- Server reads must use the **Supabase MCP tool** (`user-supabase` → `execute_sql`). Do not run raw queries via other means.
- Output must be a **persistent artifact**: **JSON + short markdown summary** committed as files (but do not commit unless explicitly asked).

### Current repo context (what’s already done)

There is an existing **items-only** reconciliation report for a different account (not transactions):
- `dev_docs/actively_implementing/reconciliation_offline_vs_server_report_2026-02-03_account-1dd4fd75.json`
- `dev_docs/actively_implementing/reconciliation_offline_vs_server_report_2026-02-03_account-1dd4fd75.md`

For transactions, work was started for **account** `2d612868-852e-4a80-9d02-9d10383898d4` using this local offline export (it includes `transactions` store):
- `dev_docs/actively_implementing/ledger-offline-export-2d612868-852e-4a80-9d02-9d10383898d4-2026-02-03T23_21_29.386Z.json`

Derived local extract (40 transactions) was created:
- `tmp/local_transactions_export_2d612868.json`

A single SQL query that computes the required reconciliation report inside Postgres (read-only) was generated:
- `tmp/transactions_reconciliation_2d612868.sql`

This SQL already includes:
- existence diffs (`localOnlyTransactions`, `serverOnlyTransactions`)
- scalar diffs with normalization:
  - numbers compared as numeric (`amount`, `taxRatePct`, `subtotal`, `sumItemPurchasePrices`)
  - text fields normalize `null`/`''` to `''` before compare
- `itemIds` membership diffs:
  - both sides reduced to **distinct**, **sorted** arrays of ids
  - filtered to `I-%` only

### Critical correction to the plan doc’s “server query guidance”
The plan doc references `public.transactions.last_updated`, but this DB schema uses:
- `updated_at` (timestamp) as the server “last updated” field

If you need a “last_updated” field in output, use:
- `updated_at as last_updated`

### What to do next (step-by-step)

1) **Run the SQL via Supabase MCP** (read-only).
   - Use `user-supabase` MCP tool `execute_sql`.
   - Query to run is exactly the contents of `tmp/transactions_reconciliation_2d612868.sql`.
   - Expected result: a single-row result containing a `report` JSON object with:
     - `reconciliation.localOnlyTransactions`
     - `reconciliation.serverOnlyTransactions`
     - `reconciliation.scalarFieldDiffs`
     - `reconciliation.itemIdsMembershipDiffs`
     - `counts.*`

2) **Persist artifacts** in `dev_docs/actively_implementing/`:
   - JSON report:
     - Suggested name:
       - `dev_docs/actively_implementing/reconciliation_transactions_offline_vs_server_report_2026-02-03_account-2d612868.json`
   - Short markdown summary:
     - Suggested name:
       - `dev_docs/actively_implementing/reconciliation_transactions_offline_vs_server_report_2026-02-03_account-2d612868.md`
   - In the markdown summary, include:
     - accountId, export source filename, generatedAt
     - counts: local transactions, server transactions, local-only, server-only, scalar diffs count, membership diffs count
     - if diffs exist: list transactionIds impacted (don’t paste giant blobs)

3) **Double-check normalization** matches the REQUIRED guidance:
   - Ensure the comparison does not flag noise from:
     - numeric formatting (`10` vs `10.0000`)
     - `null` vs empty string in text-y fields
   - Ensure `itemIds` diffs:
     - treat arrays as sets
     - filter to `I-...` only

### Notes / gotchas
- The SQL uses `jsonb_to_recordset(...)` to inline the local transaction snapshot into the query. This avoids creating temp tables (no writes).
- If the MCP `execute_sql` payload size limit is hit, a fallback is to run the reconciliation in **chunks** (split local transactions into multiple batches), then merge reports offline. Keep this as a last resort; prefer one deterministic query.
- If you need to run this for **a different accountId**, you must have a local offline export JSON that includes the `transactions` store for that account. Then regenerate the embedded JSON inside the SQL (still read-only; no DB writes).

