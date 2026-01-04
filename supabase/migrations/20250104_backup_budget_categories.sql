-- Phase 0: Preflight - Backup budget_categories table
-- This migration creates backup tables before migrating categories to account_presets

-- Backup budget_categories table
CREATE TABLE IF NOT EXISTS budget_categories_backup AS
  SELECT *, now() AS backup_created_at FROM budget_categories;

-- Verify backup row count matches source
DO $$
DECLARE
  source_count INTEGER;
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO source_count FROM budget_categories;
  SELECT COUNT(*) INTO backup_count FROM budget_categories_backup;
  
  IF source_count != backup_count THEN
    RAISE EXCEPTION 'Backup verification failed: source count (%) does not match backup count (%)', source_count, backup_count;
  END IF;
  
  RAISE NOTICE 'Backup created successfully: % rows backed up', backup_count;
END $$;

-- Add comment
COMMENT ON TABLE budget_categories_backup IS 'Backup of budget_categories table created before migration to account_presets.presets->budget_categories';
