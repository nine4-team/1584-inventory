-- Phase 1: Lock legacy budget_categories table writes
-- This migration prevents new inserts/updates to budget_categories after migration

-- Create a trigger function that rejects writes
CREATE OR REPLACE FUNCTION prevent_budget_categories_writes()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'budget_categories table is locked. Categories are now stored in account_presets.presets->budget_categories. Use RPC functions rpc_upsert_budget_category or rpc_archive_budget_category instead.';
END;
$$ LANGUAGE plpgsql;

-- Create triggers to prevent INSERT, UPDATE, DELETE
CREATE TRIGGER lock_budget_categories_insert
  BEFORE INSERT ON budget_categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_budget_categories_writes();

CREATE TRIGGER lock_budget_categories_update
  BEFORE UPDATE ON budget_categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_budget_categories_writes();

CREATE TRIGGER lock_budget_categories_delete
  BEFORE DELETE ON budget_categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_budget_categories_writes();

-- Add comment
COMMENT ON FUNCTION prevent_budget_categories_writes() IS 'Prevents writes to budget_categories table after migration to account_presets. Remove this trigger after confirming migration is complete.';
