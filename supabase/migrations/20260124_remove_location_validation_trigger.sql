-- Remove location validation trigger and function
-- This migration disables the validation that enforced items.space against project presets
-- since we're migrating to the spaces entity system

-- Drop the trigger first
DROP TRIGGER IF EXISTS trigger_validate_project_item_space ON items;

-- Drop the validation function
DROP FUNCTION IF EXISTS validate_project_item_space();

-- Add comment explaining the change
COMMENT ON TABLE items IS 'Location validation trigger removed. Spaces are now managed via the spaces table and items.space_id foreign key.';
