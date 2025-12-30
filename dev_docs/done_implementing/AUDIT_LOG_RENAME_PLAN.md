# Plan: Replace `audit_logs` with `item_audit_logs` (destructive)

Purpose
- Make the table name explicit to avoid confusion with `transaction_audit_logs`.
- We do not need to preserve existing audit rows; a drop-and-create is acceptable.

Goals
- Provide a fast, simple drop-and-create replacement.
- Update code references to the new table name.
- Provide test, rollback, and checklist items.

Assumptions
- Codebase references `audit_logs` in SQL, server code, and possibly client-side queries.
- RLS/policies and realtime publication may reference the table name.
- CI runs test suite that can catch missed references.
- No data retention is required for `public.audit_logs`.

High-level approach (simple destructive replacement)
1. Briefly pause writers (if needed).
2. Drop `public.audit_logs` (after removing any dependent objects).
3. Create `public.item_audit_logs` with the intended schema.
4. Recreate indexes, constraints, triggers, RLS policies, and grants as needed.
5. Add `public.item_audit_logs` to the realtime publication (if used).
6. Update app code to reference `public.item_audit_logs`.
7. Run tests and smoke checks.

Checklist — Before replacement
- [ ] Grep the repo for `audit_logs` occurrences:
  - search for `audit_logs` string and SQL referring to the table
  - search for `.audit_logs` (JS/TS) and raw SQL files
- [ ] Identify and remove DB dependencies on `public.audit_logs`:
  - [ ] views/materialized views selecting from it
  - [ ] triggers/functions/procedures referencing it (including dynamic SQL)
  - [ ] foreign keys from/to other tables
  - [ ] RLS policies
  - [ ] publication membership (`supabase_realtime`)
- [ ] Capture any existing grants to re-apply on the new table.
- [ ] Ensure backups/snapshots are in place (optional given no retention; still recommended).
- [ ] Update tests to use the new name.

Deployment & cutover plan (detailed)
1. Execute a single transaction to drop the old table and create the new one (see example).
2. Update code references and deploy.
3. Re-run tests & smoke checks; ensure reads/writes against `public.item_audit_logs` work as expected.

Rollback plan
- If the change causes unexpected issues, drop `public.item_audit_logs` and recreate an empty `public.audit_logs`, or revert application code to previous references. Restore from DB backup if necessary.

Post-replacement cleanup
- Update documentation and `dev_docs` references.
- Notify integrators about the change (if any external integration depends on the table name).

Examples & snippets
- Replacement migration (template):
  ```sql
  BEGIN;

  -- Drop dependent objects first if any (adjust as needed)
  -- DROP VIEW IF EXISTS public.some_view_depending_on_audit_logs;
  -- DROP TRIGGER IF EXISTS some_trigger ON public.audit_logs;

  -- Drop the old table
  DROP TABLE IF EXISTS public.audit_logs;

  -- Create the new table (define the schema you want)
  CREATE TABLE public.item_audit_logs (
    -- id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- item_id UUID NOT NULL,
    -- action TEXT NOT NULL,
    -- metadata JSONB NOT NULL DEFAULT '{}'
  );

  -- Indexes (examples)
  -- CREATE INDEX item_audit_logs_item_id_idx ON public.item_audit_logs (item_id);

  -- RLS/policies (if applicable)
  -- ALTER TABLE public.item_audit_logs ENABLE ROW LEVEL SECURITY;
  -- CREATE POLICY item_audit_logs_select ON public.item_audit_logs
  --   FOR SELECT USING (...);

  -- Grants (adjust roles)
  -- GRANT SELECT ON public.item_audit_logs TO anon, authenticated;
  -- GRANT INSERT, UPDATE, DELETE ON public.item_audit_logs TO authenticated;

  -- Realtime publication (if publication lists tables explicitly)
  ALTER PUBLICATION IF EXISTS supabase_realtime DROP TABLE public.audit_logs;
  ALTER PUBLICATION IF EXISTS supabase_realtime ADD TABLE public.item_audit_logs;

  COMMIT;
  ```

Verification
- Validate the new table exists:
  ```sql
  SELECT to_regclass('public.item_audit_logs');
  ```
- Validate publication membership:
  ```sql
  SELECT schemaname, tablename
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'item_audit_logs';
  ```
- Run smoke tests for create/read/update/delete.

Notes
- This plan is intentionally destructive and does not preserve historical audit rows.


