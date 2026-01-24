-- Backfill spaces from existing project locations and migrate items
-- This migration:
-- 1. Creates spaces from projects.settings.locations
-- 2. Migrates items.space to items.space_id by matching to spaces
-- 3. Handles edge cases (distinct items.space values not in presets)

DO $$
DECLARE
  project_record RECORD;
  location_name TEXT;
  item_record RECORD;
  created_space_id UUID;
  project_locations TEXT[];
  normalized_space TEXT;
  matched_space_id UUID;
BEGIN
  -- Step 1: Create spaces from project location presets
  FOR project_record IN 
    SELECT DISTINCT p.id, p.account_id, p.settings
    FROM projects p
    WHERE p.settings->'locations' IS NOT NULL
      AND jsonb_typeof(p.settings->'locations') = 'array'
  LOOP
    -- Extract locations array from settings
    project_locations := ARRAY(
      SELECT jsonb_array_elements_text(project_record.settings->'locations')
    );
    
    -- Create a space for each location
    FOREACH location_name IN ARRAY project_locations
    LOOP
      -- Normalize location name (trim)
      normalized_space := trim(location_name);
      
      -- Skip empty locations
      IF normalized_space = '' THEN
        CONTINUE;
      END IF;
      
      -- Check if space already exists (case-insensitive)
      SELECT id INTO matched_space_id
      FROM spaces
      WHERE account_id = project_record.account_id
        AND project_id = project_record.id
        AND lower(trim(name)) = lower(normalized_space)
      LIMIT 1;
      
      -- Create space if it doesn't exist
      IF matched_space_id IS NULL THEN
        INSERT INTO spaces (account_id, project_id, name, created_at, updated_at)
        VALUES (project_record.account_id, project_record.id, normalized_space, NOW(), NOW())
        RETURNING id INTO created_space_id;
      END IF;
    END LOOP;
  END LOOP;
  
  -- Step 2: Migrate items.space to items.space_id
  -- For each item with a non-empty space value, find or create matching space
  FOR item_record IN
    SELECT DISTINCT i.id, i.account_id, i.project_id, i.space
    FROM items i
    WHERE i.space IS NOT NULL
      AND trim(i.space) != ''
      AND i.project_id IS NOT NULL
  LOOP
    -- Normalize space value
    normalized_space := trim(item_record.space);
    
    -- Find matching space (case-insensitive) within the same project
    SELECT id INTO matched_space_id
    FROM spaces
    WHERE account_id = item_record.account_id
      AND project_id = item_record.project_id
      AND lower(trim(name)) = lower(normalized_space)
    LIMIT 1;
    
    -- If no match found, create a new space for this project
    IF matched_space_id IS NULL THEN
      INSERT INTO spaces (account_id, project_id, name, created_at, updated_at)
      VALUES (item_record.account_id, item_record.project_id, normalized_space, NOW(), NOW())
      RETURNING id INTO matched_space_id;
    END IF;
    
    -- Update item with space_id
    UPDATE items
    SET space_id = matched_space_id
    WHERE id = item_record.id;
  END LOOP;
  
  RAISE NOTICE 'Backfill complete: spaces created and items migrated';
END $$;
