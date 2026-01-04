-- Add RPC functions for merging account_presets JSON sections
-- This prevents write-on-read operations from overwriting sibling keys
-- (e.g., budget_categories being deleted when tax_presets is initialized)

-- Function to merge a specific section into account_presets.presets
-- This ensures atomic merge semantics at the database level
CREATE OR REPLACE FUNCTION rpc_merge_account_presets_section(
  p_account_id uuid,
  p_section text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_presets jsonb;
  v_updated_presets jsonb;
  v_section_path text[];
BEGIN
  -- Ensure account_presets row exists
  INSERT INTO account_presets (account_id, presets, created_at, updated_at)
  VALUES (p_account_id, '{}'::jsonb, now(), now())
  ON CONFLICT (account_id) DO NOTHING;
  
  -- Get current presets
  SELECT COALESCE(presets, '{}'::jsonb) INTO v_current_presets
  FROM account_presets
  WHERE account_id = p_account_id;
  
  -- Build the JSON path array (e.g., ['tax_presets'])
  v_section_path := ARRAY[p_section];
  
  -- Merge p_payload into the specified section using jsonb_set
  -- The 'true' parameter creates the path if it doesn't exist
  v_updated_presets := jsonb_set(
    v_current_presets,
    v_section_path,
    p_payload,
    true  -- create_missing = true
  );
  
  -- Update the presets column
  UPDATE account_presets
  SET presets = v_updated_presets,
      updated_at = now()
  WHERE account_id = p_account_id;
  
  -- Return the updated section
  RETURN v_updated_presets->p_section;
END;
$$;

COMMENT ON FUNCTION rpc_merge_account_presets_section IS 'Merges a JSON section into account_presets.presets atomically, preserving sibling keys. Use this instead of direct upsert to prevent data loss.';

-- Function to initialize a preset section only if it's missing
-- Useful for migrations and seeding defaults without overwriting existing data
CREATE OR REPLACE FUNCTION rpc_initialize_presets_section_if_absent(
  p_account_id uuid,
  p_section text,
  p_default jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_presets jsonb;
  v_section_value jsonb;
  v_section_path text[];
BEGIN
  -- Ensure account_presets row exists
  INSERT INTO account_presets (account_id, presets, created_at, updated_at)
  VALUES (p_account_id, '{}'::jsonb, now(), now())
  ON CONFLICT (account_id) DO NOTHING;
  
  -- Get current presets
  SELECT COALESCE(presets, '{}'::jsonb) INTO v_current_presets
  FROM account_presets
  WHERE account_id = p_account_id;
  
  -- Check if section exists and is not null
  v_section_value := v_current_presets->p_section;
  
  -- Only initialize if section is NULL or missing
  IF v_section_value IS NULL OR v_section_value = 'null'::jsonb THEN
    v_section_path := ARRAY[p_section];
    
    -- Set the default value
    v_current_presets := jsonb_set(
      v_current_presets,
      v_section_path,
      p_default,
      true
    );
    
    -- Update the presets column
    UPDATE account_presets
    SET presets = v_current_presets,
        updated_at = now()
    WHERE account_id = p_account_id;
    
    RETURN p_default;
  ELSE
    -- Return existing value
    RETURN v_section_value;
  END IF;
END;
$$;

COMMENT ON FUNCTION rpc_initialize_presets_section_if_absent IS 'Initializes a preset section with defaults only if it is NULL or missing. Safe to call multiple times without overwriting existing data.';

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION rpc_merge_account_presets_section(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_initialize_presets_section_if_absent(uuid, text, jsonb) TO authenticated;
