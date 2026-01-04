-- Seed default budget categories for all existing accounts
-- This migration ensures every account has at least the four required default categories:
-- - Furnishings (slug: furnishings)
-- - Install (slug: install)
-- - Design Fee (slug: design-fee)
-- - Storage & Receiving (slug: storage-receiving)

DO $$
DECLARE
  v_account_id uuid;
  v_presets jsonb;
  v_categories jsonb;
  v_category_slug text;
  v_category_name text;
  v_category_exists boolean;
  v_furnishings_category_id uuid;
  v_default_categories jsonb := jsonb_build_array(
    jsonb_build_object('name', 'Furnishings', 'slug', 'furnishings'),
    jsonb_build_object('name', 'Install', 'slug', 'install'),
    jsonb_build_object('name', 'Design Fee', 'slug', 'design-fee'),
    jsonb_build_object('name', 'Storage & Receiving', 'slug', 'storage-receiving')
  );
BEGIN
  -- Iterate through all accounts
  FOR v_account_id IN SELECT id FROM accounts LOOP
    BEGIN
      -- Ensure account_presets row exists
      INSERT INTO account_presets (account_id, presets, created_at, updated_at)
      VALUES (v_account_id, '{}'::jsonb, now(), now())
      ON CONFLICT (account_id) DO NOTHING;
      
      -- Get current presets
      SELECT presets INTO v_presets
      FROM account_presets
      WHERE account_id = v_account_id;
      
      -- Initialize categories array if it doesn't exist
      IF v_presets->'budget_categories' IS NULL THEN
        v_categories := '[]'::jsonb;
      ELSE
        v_categories := v_presets->'budget_categories';
      END IF;
      
      -- Seed each default category using the RPC function
      -- Check each one individually to make migration idempotent
      FOR i IN 0..jsonb_array_length(v_default_categories) - 1 LOOP
        v_category_name := v_default_categories->i->>'name';
        v_category_slug := v_default_categories->i->>'slug';
        
        -- Refresh categories from database before checking (in case previous iteration created one)
        SELECT presets->'budget_categories' INTO v_categories
        FROM account_presets
        WHERE account_id = v_account_id;
        
        -- Initialize if null
        IF v_categories IS NULL THEN
          v_categories := '[]'::jsonb;
        END IF;
        
        -- Check if category with this slug already exists (non-archived)
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_categories) AS cat
          WHERE cat->>'slug' = v_category_slug
            AND (cat->>'is_archived')::boolean = false
        ) INTO v_category_exists;
        
        -- Only create if it doesn't exist
        IF NOT v_category_exists THEN
          -- Call RPC function to create the category
          PERFORM rpc_upsert_budget_category(
            p_account_id := v_account_id,
            p_name := v_category_name,
            p_slug := v_category_slug,
            p_metadata := jsonb_build_object('is_default', true),
            p_is_archived := false
          );
        END IF;
      END LOOP;
      
      -- Set Furnishings as the default category (only if default_category_id is not already set)
      IF NOT EXISTS (
        SELECT 1 FROM account_presets
        WHERE account_id = v_account_id
          AND default_category_id IS NOT NULL
      ) THEN
        
        -- Get the furnishings category ID from the updated presets
        SELECT presets->'budget_categories' INTO v_categories
        FROM account_presets
        WHERE account_id = v_account_id;
        
        -- Find furnishings category ID
        SELECT (cat->>'id')::uuid INTO v_furnishings_category_id
        FROM jsonb_array_elements(v_categories) AS cat
        WHERE cat->>'slug' = 'furnishings'
          AND (cat->>'is_archived')::boolean = false
        LIMIT 1;
        
        -- Update default_category_id if we found furnishings
        IF v_furnishings_category_id IS NOT NULL THEN
          UPDATE account_presets
          SET default_category_id = v_furnishings_category_id
          WHERE account_id = v_account_id;
        END IF;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue with next account
      RAISE WARNING 'Failed to seed default categories for account %: %', v_account_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- Add comment
COMMENT ON FUNCTION rpc_upsert_budget_category IS 'Creates or updates a budget category in account_presets.presets->budget_categories. Used by migration to seed default categories.';
