-- Remediation migration: Reseed budget_categories for accounts that may have lost them
-- This migration addresses accounts where budget_categories were deleted due to write-on-read
-- operations in taxPresetsService or vendorDefaultsService overwriting the presets column.
--
-- This migration uses the RPC function rpc_initialize_presets_section_if_absent to safely
-- reseed categories only if they are missing, without overwriting existing data.

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
  v_accounts_affected integer := 0;
  v_accounts_fixed integer := 0;
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
      
      -- Check if budget_categories section is missing or empty
      v_categories := v_presets->'budget_categories';
      
      -- Count non-archived categories if they exist
      IF v_categories IS NOT NULL AND jsonb_typeof(v_categories) = 'array' THEN
        SELECT COUNT(*) INTO v_category_exists
        FROM jsonb_array_elements(v_categories) AS cat
        WHERE (cat->>'is_archived')::boolean = false;
      ELSE
        v_category_exists := false;
      END IF;
      
      -- Only reseed if categories are missing or all archived
      IF NOT v_category_exists THEN
        v_accounts_affected := v_accounts_affected + 1;
        
        -- Clear invalid default_category_id if it points to a non-existent category
        UPDATE account_presets
        SET default_category_id = NULL
        WHERE account_id = v_account_id
          AND default_category_id IS NOT NULL
          AND (
            v_categories IS NULL 
            OR jsonb_typeof(v_categories) != 'array'
            OR NOT EXISTS (
              SELECT 1 
              FROM jsonb_array_elements(v_categories) AS cat
              WHERE (cat->>'id')::uuid = default_category_id
            )
          );
        
        -- Seed each default category using the RPC function
        FOR i IN 0..jsonb_array_length(v_default_categories) - 1 LOOP
          v_category_name := v_default_categories->i->>'name';
          v_category_slug := v_default_categories->i->>'slug';
          
          -- Call RPC function to create the category
          -- This will merge safely without overwriting other preset sections
          PERFORM rpc_upsert_budget_category(
            p_account_id := v_account_id,
            p_name := v_category_name,
            p_slug := v_category_slug,
            p_metadata := jsonb_build_object('is_default', true, 'remediated_at', now()::text),
            p_is_archived := false
          );
        END LOOP;
        
        -- Set Furnishings as the default category (only if default_category_id is not already set or was invalid)
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
        
        v_accounts_fixed := v_accounts_fixed + 1;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue with next account
      RAISE WARNING 'Failed to remediate budget categories for account %: %', v_account_id, SQLERRM;
    END;
  END LOOP;
  
  -- Log summary
  RAISE NOTICE 'Budget categories remediation complete. Accounts checked: %, Accounts fixed: %', 
    (SELECT COUNT(*) FROM accounts), v_accounts_fixed;
END $$;

-- Add a comment documenting this remediation
COMMENT ON FUNCTION rpc_merge_account_presets_section IS 'Merges a JSON section into account_presets.presets atomically, preserving sibling keys. Use this instead of direct upsert to prevent data loss. This migration remediates accounts that lost budget_categories due to write-on-read operations.';
