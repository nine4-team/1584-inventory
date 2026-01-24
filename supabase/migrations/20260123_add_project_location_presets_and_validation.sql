-- Add project location presets and validate items.space against project presets
-- This migration:
-- 1. Backfills projects.settings.locations from existing items.space values
-- 2. Creates a validation function to ensure items.space belongs to project presets
-- 3. Creates a trigger to enforce validation

-- Step 1: Backfill project locations from existing items.space values
-- For each project, collect distinct non-empty space values and add them to settings.locations
DO $$
DECLARE
  project_record RECORD;
  space_values TEXT[];
  existing_locations TEXT[];
  merged_locations TEXT[];
BEGIN
  FOR project_record IN 
    SELECT DISTINCT p.id, p.settings
    FROM projects p
    INNER JOIN items i ON i.project_id = p.id
    WHERE i.space IS NOT NULL AND trim(i.space) != ''
  LOOP
    -- Collect distinct space values for this project (trimmed, non-empty)
    SELECT array_agg(DISTINCT trim(i.space))
    INTO space_values
    FROM items i
    WHERE i.project_id = project_record.id
      AND i.space IS NOT NULL
      AND trim(i.space) != '';
    
    -- Get existing locations from settings (if any)
    existing_locations := COALESCE(
      CASE
        WHEN jsonb_typeof(project_record.settings->'locations') = 'array' THEN
          ARRAY(SELECT jsonb_array_elements_text(project_record.settings->'locations'))
        ELSE ARRAY[]::TEXT[]
      END,
      ARRAY[]::TEXT[]
    );
    
    -- Merge and dedupe (case-insensitive, preserving first-seen casing)
    WITH combined AS (
      SELECT location, ordinality
      FROM unnest(array_cat(existing_locations, COALESCE(space_values, ARRAY[]::TEXT[])))
        WITH ORDINALITY AS t(location, ordinality)
      WHERE trim(location) != ''
    ),
    deduped AS (
      SELECT DISTINCT ON (lower(trim(location))) location, ordinality
      FROM combined
      ORDER BY lower(trim(location)), ordinality
    )
    SELECT array_agg(location ORDER BY ordinality)
    INTO merged_locations
    FROM deduped;
    
    -- Update project settings with merged locations
    UPDATE projects
    SET settings = COALESCE(settings, '{}'::jsonb) || 
        jsonb_build_object('locations', to_jsonb(merged_locations)),
        updated_at = timezone('utc', now())
    WHERE id = project_record.id;
  END LOOP;
END $$;

-- Step 2: Create validation function
-- This function validates that items.space (when project_id is set) exists in project's location presets
CREATE OR REPLACE FUNCTION validate_project_item_space()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_settings JSONB;
  project_locations TEXT[];
  normalized_space TEXT;
BEGIN
  -- If project_id is NULL, do nothing (business inventory items)
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Normalize space: trim and treat empty as NULL
  normalized_space := NULLIF(trim(NEW.space), '');
  
  -- If space is NULL/empty, allow it
  IF normalized_space IS NULL THEN
    -- Set to NULL explicitly to ensure consistency
    NEW.space := NULL;
    RETURN NEW;
  END IF;
  
  -- Fetch project settings
  SELECT settings INTO project_settings
  FROM projects
  WHERE id = NEW.project_id;
  
  -- If project not found, allow (will be caught by FK constraint if exists)
  IF project_settings IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Extract locations array from settings
  project_locations := COALESCE(
    CASE
      WHEN jsonb_typeof(project_settings->'locations') = 'array' THEN
        ARRAY(SELECT jsonb_array_elements_text(project_settings->'locations'))
      ELSE ARRAY[]::TEXT[]
    END,
    ARRAY[]::TEXT[]
  );
  
  -- Check if normalized_space exists in project_locations (case-insensitive)
  IF NOT EXISTS (
    SELECT 1
    FROM unnest(project_locations) AS loc
    WHERE lower(trim(loc)) = lower(normalized_space)
  ) THEN
    RAISE EXCEPTION 
      'Item space "%" is not in the project''s location presets. Please add it to the project locations first.',
      normalized_space
      USING HINT = 'Add this location to the project settings in the Create/Edit Project modal.';
  END IF;
  
  -- Ensure space is stored with normalized value (trimmed)
  NEW.space := normalized_space;
  
  RETURN NEW;
END;
$$;

-- Step 3: Create trigger
-- Trigger fires BEFORE INSERT OR UPDATE OF space, project_id
DROP TRIGGER IF EXISTS trigger_validate_project_item_space ON items;

CREATE TRIGGER trigger_validate_project_item_space
  BEFORE INSERT OR UPDATE OF space, project_id
  ON items
  FOR EACH ROW
  EXECUTE FUNCTION validate_project_item_space();

-- Add comment explaining the trigger
COMMENT ON TRIGGER trigger_validate_project_item_space ON items IS 
  'Validates that items.space (when project_id is set) exists in the project''s settings.locations array. ' ||
  'Prevents inconsistent location spelling and ensures all item spaces are managed via project presets.';
