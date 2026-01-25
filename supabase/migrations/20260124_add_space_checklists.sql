-- Add checklists JSONB column to spaces and space_templates tables
-- Checklists store multiple named checklists with items that can be checked/unchecked

-- Add checklists column to spaces table
ALTER TABLE spaces ADD COLUMN checklists JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add checklists column to space_templates table
ALTER TABLE space_templates ADD COLUMN checklists JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add comments
COMMENT ON COLUMN spaces.checklists IS 'JSONB array of SpaceChecklist objects. Each checklist has id, name, and items array. Items have id, text, and isChecked boolean.';
COMMENT ON COLUMN space_templates.checklists IS 'JSONB array of SpaceChecklist objects (same structure as spaces.checklists). Used as defaults when creating spaces from templates. All items should have isChecked=false in templates.';
