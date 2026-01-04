## Budget Categories → Account Presets Migration (Lean Plan)

This is the stripped-down path for consolidating `budget_categories` into `account_presets` without the heavyweight telemetry/automation machinery. It assumes:

- No one is editing categories during the window (because the feature is unused or already disabled), so we don’t need dual writes or new locks.
- You can run SQL directly against Supabase (psql/Supabase SQL editor).
- If something goes wrong, it’s acceptable to pause the app for a bit, restore data from a backup table, and try again.

The objective is simple: move the data, point the app at the new location, confirm counts/checksums, and keep a fast rollback lever.

---

### Phase 0 – Preflight (same day as migration)

1. **Back up the table**
   - Run:
     ```sql
     CREATE TABLE IF NOT EXISTS budget_categories_backup AS
       SELECT *, now() AS backup_created_at FROM budget_categories;
     ```
   - Verify the row count matches the source table:
     ```sql
     SELECT COUNT(*) FROM budget_categories;
     SELECT COUNT(*) FROM budget_categories_backup;
     ```
2. **Snapshot ordering info**
   - If you use `budget_category_order`, copy that table the same way (`budget_category_order_backup`).
3. **Confirm `account_presets` rows exist**
   - ```sql
     SELECT COUNT(*) FROM accounts a
     WHERE NOT EXISTS (
       SELECT 1 FROM account_presets ap WHERE ap.account_id = a.id
     );
     ```
   - If non-zero, create missing rows before moving on.

---

### Phase 1 – Single Migration/Backfill

1. **Embed categories**
   - Use one SQL migration (example `supabase/migrations/20250103_embed_budget_categories.sql`) that:
     - Aggregates each account’s categories ordered by `budget_category_order`.
     - Writes them into `account_presets.presets->'budget_categories'`.
     - Records a `last_migrated_at` timestamp in `account_presets`.
2. **Lock the legacy table**
   - Immediately after writing, set RLS or a trigger to reject new inserts/updates to `budget_categories` so it stays frozen while you verify.

---

### Phase 2 – Quick Verification (counts + checksum)

1. **Counts per account**
   - ```sql
     WITH table_counts AS (
       SELECT account_id, COUNT(*) AS cnt
       FROM budget_categories
       GROUP BY account_id
     ), embedded_counts AS (
       SELECT account_id,
              jsonb_array_length(presets->'budget_categories') AS cnt
       FROM account_presets
     )
     SELECT tc.account_id, tc.cnt AS table_cnt, ec.cnt AS embedded_cnt
     FROM table_counts tc
     LEFT JOIN embedded_counts ec USING (account_id)
     WHERE COALESCE(tc.cnt,0) <> COALESCE(ec.cnt,0);
     ```
   - Expect **zero** rows. If rows show up, stop and investigate before touching the app.
2. **Checksum**
   - ```sql
     WITH serialized AS (
       SELECT account_id,
              md5(jsonb_agg(to_jsonb(bc) ORDER BY bco.position)::text) AS checksum
       FROM budget_categories bc
       LEFT JOIN budget_category_order bco
         ON bco.account_id = bc.account_id
        AND bco.budget_category_id = bc.id
       GROUP BY account_id
     ),
     embedded AS (
       SELECT account_id,
              md5((presets->'budget_categories')::text) AS checksum
       FROM account_presets
     )
     SELECT s.account_id
     FROM serialized s
     LEFT JOIN embedded e USING (account_id)
     WHERE s.checksum <> e.checksum;
     ```
   - Again, expect zero rows. If not, delete/rewrite the mismatched account’s embedded data using the backup table.

At this point the data is proven equivalent. Total elapsed time should be minutes, not days.

---

### Phase 3 – Update the App (code audit)

These are the concrete code edits the AI/junior dev needs to make so the UI talks to the embedded categories. Tests are intentionally excluded from this list; we only touch runtime code.

1. **`src/services/budgetCategoriesService.ts`**
   - Replace every `.from('budget_categories')` call with either:
     - Reads: `.from('vw_budget_categories')` (a view that unnests `account_presets.presets->budget_categories`) filtered by `account_id`, **or**
     - Writes: call a stored procedure `rpc_upsert_budget_category` / `rpc_archive_budget_category` that edits the JSON array.
   - Ensure the returned objects keep the same shape (`BudgetCategory`) so downstream components stay unchanged.
   - Update `createCategory`, `updateCategory`, `archiveCategory`, `unarchiveCategory` to call the RPC rather than writing directly to the legacy table.
   - In the offline fallback path, make sure we cache the embedded payload once per account so the cache stays alive after the table is gone.

2. **`src/services/offlineMetadataService.ts`**
   - `cacheBudgetCategoriesOffline` still fetches categories directly; point it at `vw_budget_categories` (same filters) so offline cache mirrors the embedded source.
   - Double-check the serialization order matches what the backfill writes (ordered array) so checksum comparisons aren’t surprised by reordering.

3. **`src/components/CategorySelect.tsx` and any hooks that call `budgetCategoriesService`**
   - No direct table access, but we need to manually test that the dropdown still hydrates and that archiving/creating via the modal works with the new service backing.
   - Update helper text if necessary to clarify that categories live under presets (optional).

4. **`src/services/operationQueue.ts` + `src/services/inventoryService.ts`**
   - Both serialize `budgetCategories` inside the `projects` payload. Confirm they no longer expect the standalone table:
     - Any place that re-fetches categories from Supabase should now call `budgetCategoriesService`.
     - When syncing projects offline/online, ensure `budgetCategories` field is kept in sync with the embedded source (or dropped if redundant).

5. **`src/contexts/BusinessProfileContext.tsx`, `src/pages/AddTransaction.tsx`, `src/pages/InventoryList.tsx`, `src/pages/InviteAccept.tsx`**
   - Search for table name usage (`budget_categories`) and reroute through the updated service or the new view.
   - Re-test flows that auto-create categories during onboarding or invite acceptance; they must call the new RPC.

6. **`src/types/index.ts`**
   - Keep the `BudgetCategory` interface intact but confirm any comments referencing the old table are updated (“IDs come from embedded presets”).

Once these edits are in place, the application no longer references the legacy table directly.

### Phase 4 – Deploy and validate

1. **Smoke tests**
   - Create/Edit/Delete a category in staging pointing at the new code path, confirm it shows up in the UI and in `account_presets`.
   - Load the offline experience (toggle airplane mode) and verify cached categories render.
2. **Deploy & re-run SQL verification**
   - Deploy the app changes.
   - Run the count/checksum SQL again in production to make sure post-deploy writes behave.

---

### Phase 4 – Fast Rollback Plan

If anything looks wrong:

1. **Restore from backup**
   - ```sql
     TRUNCATE budget_categories;
     INSERT INTO budget_categories (...)
     SELECT ... FROM budget_categories_backup;
     ```
2. **Re-enable table writes**
   - Remove the RLS/trigger lock.
3. **Redeploy app with legacy reads.**

Because the backup table is in the same database and untouched after Phase 1, restoring should take minutes.

---

### Phase 5 – Clean Up (next day)

1. Rerun the verification SQL once more.
2. If all good, drop `budget_categories`, `budget_category_order`, and the backup tables.
3. Remove any temporary flags/locks introduced for the freeze.

---

### Checklist Summary (for the AI/junior dev)

1. Freeze category edits.
2. Copy `budget_categories` (and order table) into `_backup` tables.
3. Run the embed/backfill migration script.
4. Lock legacy table writes.
5. Run count + checksum SQL; resolve any mismatches.
6. Switch services to read embedded data; deploy.
7. Re-run verification after deploy.
8. Keep backup tables for at least one day; drop them once confident.

No dashboards, no long-term telemetry loops—just SQL scripts with immediate rollback available.

---

### Created Migration Files

The following migration files have been created in `supabase/migrations/`:

1. **20250104_00_create_account_presets.sql**
   - Creates `account_presets` table if it doesn't exist
   - Sets up RLS policies for account presets
   - Ensures table structure is ready before migration

2. **20250104_backup_budget_categories.sql**
   - Creates `budget_categories_backup` table
   - Copies all rows from `budget_categories` with backup timestamp
   - Verifies backup row count matches source

3. **20250104_embed_budget_categories.sql**
   - Ensures `account_presets` rows exist for all accounts
   - Embeds categories from `budget_categories` into `account_presets.presets->budget_categories`
   - Preserves ordering using `budget_category_order` if available
   - Records `last_migrated_at` timestamp

4. **20250104_lock_budget_categories.sql**
   - Creates triggers to prevent INSERT/UPDATE/DELETE on `budget_categories` table
   - Forces use of RPC functions for all category operations
   - Provides clear error messages directing users to RPC functions

5. **20250104_verify_budget_categories_migration.sql**
   - Contains verification queries for count comparison per account
   - Contains verification queries for checksum comparison
   - Both queries should return zero rows if migration succeeded

6. **20250104_create_budget_categories_view.sql**
   - Creates `vw_budget_categories` view that unnests embedded categories
   - Provides backward-compatible table-like interface for reads
   - Handles metadata null values correctly

7. **20250104_create_budget_category_rpc_functions.sql**
   - Creates `rpc_upsert_budget_category` function for create/update operations
   - Creates `rpc_archive_budget_category` function for archive/unarchive operations
   - Handles slug generation and uniqueness validation
   - Maintains category ordering

**Execution Order:**
1. `20250104_00_create_account_presets.sql` (if table doesn't exist)
2. `20250104_backup_budget_categories.sql`
3. `20250104_embed_budget_categories.sql`
4. `20250104_lock_budget_categories.sql`
5. Run verification queries from `20250104_verify_budget_categories_migration.sql`
6. Deploy app code changes
7. `20250104_create_budget_categories_view.sql` (can run before or after app deploy)
8. `20250104_create_budget_category_rpc_functions.sql` (must run before app deploy)

---

### Outstanding Follow-ups (before declaring done)

1. **Finish migrating foreign key dependencies off `budget_categories`.**
   - `transactions.category_id`, `projects.default_category_id` (plus its trigger), and `account_presets.default_category_id` must be updated to validate against the embedded presets instead of the legacy table.
   - Write follow-up migrations that drop those FK constraints/triggers and replace them with validations suited for the new storage model before locking the old table permanently.
2. **Preserve slug uniqueness.**
   - The old unique index (`UNIQUE(account_id, slug)`) no longer runs when writes happen via RPC; add duplicate detection for update paths (or a replacement constraint) so two categories in the same account can’t share a slug.
3. **Update automated tests.**
   - `budgetCategoriesService` tests still mock `.from('budget_categories')`; rewrite them to cover `vw_budget_categories` reads and the new RPC calls so CI continues to reflect our runtime behavior.

---

### ✅ Follow-ups Completed (2025-01-04)

All outstanding follow-ups have been completed:

1. ✅ **Foreign key dependencies migrated** - Created `20250104_replace_budget_category_fks.sql` migration that replaces FK constraints with validation functions checking embedded presets.

2. ✅ **Slug uniqueness preserved** - Updated `rpc_upsert_budget_category` to check slug uniqueness on both create and update operations.

3. ✅ **Automated tests updated** - Rewrote `budgetCategoriesService.test.ts` to use `vw_budget_categories` view and RPC mocks instead of direct table access.
