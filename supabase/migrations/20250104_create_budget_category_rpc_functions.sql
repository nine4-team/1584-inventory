-- Phase 3: Create RPC functions for budget category operations
-- These functions allow the app to create/update/archive categories
-- by modifying the embedded JSON array in account_presets

-- Function to upsert a budget category
CREATE OR REPLACE FUNCTION rpc_upsert_budget_category(
  p_account_id uuid,
  p_name text,
  p_category_id uuid DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_is_archived boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_presets jsonb;
  v_categories jsonb;
  v_category jsonb;
  v_new_category_id uuid;
  v_slug text;
  v_found boolean := false;
BEGIN
  -- Get current presets
  SELECT presets INTO v_presets
  FROM account_presets
  WHERE account_id = p_account_id;
  
  IF v_presets IS NULL THEN
    -- Create account_presets row if it doesn't exist
    INSERT INTO account_presets (account_id, presets, created_at, updated_at)
    VALUES (p_account_id, '{}'::jsonb, now(), now())
    ON CONFLICT (account_id) DO NOTHING
    RETURNING presets INTO v_presets;
    
    IF v_presets IS NULL THEN
      SELECT presets INTO v_presets FROM account_presets WHERE account_id = p_account_id;
    END IF;
  END IF;
  
  -- Initialize categories array if it doesn't exist
  IF v_presets->'budget_categories' IS NULL THEN
    v_categories := '[]'::jsonb;
  ELSE
    v_categories := v_presets->'budget_categories';
  END IF;
  
  -- Generate slug if not provided
  IF p_slug IS NULL THEN
    v_slug := lower(regexp_replace(p_name, '[^a-z0-9]+', '-', 'gi'));
    v_slug := trim(both '-' from v_slug);
  ELSE
    v_slug := p_slug;
  END IF;
  
  -- Check if category with same slug exists (for uniqueness check)
  IF p_category_id IS NULL THEN
    -- Creating new category
    v_new_category_id := gen_random_uuid();
    
    -- Check for duplicate slug
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_categories) AS cat
      WHERE cat->>'slug' = v_slug AND (cat->>'account_id')::uuid = p_account_id
    ) THEN
      RAISE EXCEPTION 'Category with slug % already exists for this account', v_slug;
    END IF;
    
    -- Create new category object
    v_category := jsonb_build_object(
      'id', v_new_category_id::text,
      'account_id', p_account_id::text,
      'name', p_name,
      'slug', v_slug,
      'is_archived', p_is_archived,
      'metadata', CASE WHEN p_metadata IS NULL THEN jsonb 'null' ELSE to_jsonb(p_metadata) END,
      'created_at', now()::text,
      'updated_at', now()::text
    );
    
    -- Append to categories array
    v_categories := v_categories || v_category;
  ELSE
    -- Updating existing category
    v_new_category_id := p_category_id;
    
    -- Determine the final slug (use provided slug or keep existing)
    IF p_slug IS NOT NULL THEN
      v_slug := p_slug;
    ELSE
      -- Get existing slug from the category being updated
      SELECT cat->>'slug' INTO v_slug
      FROM jsonb_array_elements(v_categories) AS cat
      WHERE (cat->>'id')::uuid = p_category_id;
      
      IF v_slug IS NULL THEN
        RAISE EXCEPTION 'Category with id % not found', p_category_id;
      END IF;
    END IF;
    
    -- Check for duplicate slug (excluding the category being updated)
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_categories) AS cat
      WHERE cat->>'slug' = v_slug 
        AND (cat->>'id')::uuid != p_category_id
        AND (cat->>'account_id')::uuid = p_account_id
    ) THEN
      RAISE EXCEPTION 'Category with slug % already exists for this account', v_slug;
    END IF;
    
    -- Find and update the category
    SELECT jsonb_agg(
      CASE 
        WHEN (cat->>'id')::uuid = p_category_id THEN
          jsonb_build_object(
            'id', cat->>'id',
            'account_id', cat->>'account_id',
            'name', p_name,
            'slug', v_slug,
            'is_archived', COALESCE(p_is_archived, (cat->>'is_archived')::boolean),
            'metadata', CASE 
              WHEN p_metadata IS NOT NULL THEN to_jsonb(p_metadata)
              WHEN cat->>'metadata' = 'null' THEN jsonb 'null'
              ELSE cat->'metadata'
            END,
            'created_at', cat->>'created_at',
            'updated_at', now()::text
          )
        ELSE cat
      END
    ) INTO v_categories
    FROM jsonb_array_elements(v_categories) AS cat;
    
    -- Check if category was found
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_categories) AS cat
      WHERE (cat->>'id')::uuid = p_category_id
    ) INTO v_found;
    
    IF NOT v_found THEN
      RAISE EXCEPTION 'Category with id % not found', p_category_id;
    END IF;
  END IF;
  
  -- Update account_presets
  UPDATE account_presets
  SET 
    presets = jsonb_set(
      COALESCE(presets, '{}'::jsonb),
      '{budget_categories}',
      v_categories,
      true
    ),
    updated_at = now()
  WHERE account_id = p_account_id;
  
  -- Return the category
  SELECT cat INTO v_category
  FROM jsonb_array_elements(v_categories) AS cat
  WHERE (cat->>'id')::uuid = v_new_category_id;
  
  RETURN v_category;
END;
$$;

-- Function to archive/unarchive a budget category
CREATE OR REPLACE FUNCTION rpc_archive_budget_category(
  p_account_id uuid,
  p_category_id uuid,
  p_is_archived boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_presets jsonb;
  v_categories jsonb;
  v_category jsonb;
  v_found boolean := false;
BEGIN
  -- Get current presets
  SELECT presets INTO v_presets
  FROM account_presets
  WHERE account_id = p_account_id;
  
  IF v_presets IS NULL OR v_presets->'budget_categories' IS NULL THEN
    RAISE EXCEPTION 'Account presets or budget categories not found';
  END IF;
  
  v_categories := v_presets->'budget_categories';
  
  -- Update the category's is_archived flag
  SELECT jsonb_agg(
    CASE 
      WHEN (cat->>'id')::uuid = p_category_id THEN
        jsonb_set(
          cat,
          '{is_archived}',
          to_jsonb(p_is_archived),
          true
        ) || jsonb_build_object('updated_at', now()::text)
      ELSE cat
    END
  ) INTO v_categories
  FROM jsonb_array_elements(v_categories) AS cat;
  
  -- Check if category was found
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_categories) AS cat
    WHERE (cat->>'id')::uuid = p_category_id
  ) INTO v_found;
  
  IF NOT v_found THEN
    RAISE EXCEPTION 'Category with id % not found', p_category_id;
  END IF;
  
  -- Update account_presets
  UPDATE account_presets
  SET 
    presets = jsonb_set(
      presets,
      '{budget_categories}',
      v_categories,
      true
    ),
    updated_at = now()
  WHERE account_id = p_account_id;
  
  -- Return the updated category
  SELECT cat INTO v_category
  FROM jsonb_array_elements(v_categories) AS cat
  WHERE (cat->>'id')::uuid = p_category_id;
  
  RETURN v_category;
END;
$$;

-- Add comments
COMMENT ON FUNCTION rpc_upsert_budget_category IS 'Creates or updates a budget category in account_presets.presets->budget_categories';
COMMENT ON FUNCTION rpc_archive_budget_category IS 'Archives or unarchives a budget category in account_presets.presets->budget_categories';
