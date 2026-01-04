-- Clean up project budget_categories that reference deleted/recreated category IDs
-- When categories were deleted and recreated, they got new UUIDs, but projects still reference old IDs.
-- This migration removes orphaned category IDs (categories that no longer exist).
-- Users will need to re-enter budget amounts for those categories when editing the project.

DO $$
DECLARE
  v_project RECORD;
  v_old_category_id text;
  v_budget_amount numeric;
  v_new_category_id uuid;
  v_new_budget_categories jsonb;
  v_updated_count integer := 0;
  v_orphaned_count integer := 0;
BEGIN
  -- Process each project
  FOR v_project IN 
    SELECT id, account_id, budget_categories
    FROM projects
    WHERE budget_categories IS NOT NULL
      AND jsonb_typeof(budget_categories) = 'object'
  LOOP
    v_new_budget_categories := '{}'::jsonb;
    v_orphaned_count := 0;
    
    -- Process each category ID in the project's budget_categories
    FOR v_old_category_id IN 
      SELECT jsonb_object_keys(v_project.budget_categories)
    LOOP
      v_budget_amount := (v_project.budget_categories->>v_old_category_id)::numeric;
      
      -- Check if this category ID exists in current account categories
      SELECT (cat->>'id')::uuid INTO v_new_category_id
      FROM account_presets ap,
      jsonb_array_elements(ap.presets->'budget_categories') AS cat
      WHERE ap.account_id = v_project.account_id
        AND (cat->>'id')::uuid::text = v_old_category_id
        AND (cat->>'is_archived')::boolean = false
      LIMIT 1;
      
      -- If category exists, keep it
      IF v_new_category_id IS NOT NULL THEN
        v_new_budget_categories := v_new_budget_categories || jsonb_build_object(v_new_category_id::text, v_budget_amount);
      ELSE
        -- Category doesn't exist - skip it (orphaned entry)
        v_orphaned_count := v_orphaned_count + 1;
        RAISE NOTICE 'Removing orphaned category ID % (budget: %) from project %', v_old_category_id, v_budget_amount, v_project.id;
      END IF;
    END LOOP;
    
    -- Update the project if we removed orphaned entries
    IF v_orphaned_count > 0 THEN
      UPDATE projects
      SET budget_categories = v_new_budget_categories,
          updated_at = now()
      WHERE id = v_project.id;
      
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Cleaned up orphaned budget category IDs for % projects', v_updated_count;
END $$;

COMMENT ON COLUMN projects.budget_categories IS 'JSONB object mapping category UUIDs to budget amounts. After category migration, old IDs may need remapping via migration 20260104_remap_project_budget_category_ids.';
