-- Create spaces table and add space_id FK to items
-- This migration:
-- 1. Creates the spaces table with proper structure
-- 2. Adds space_id column to items table
-- 3. Sets up RLS policies for spaces
-- 4. Creates necessary indexes

-- Verify prerequisite RLS helper function exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'can_access_account'
  ) THEN
    RAISE EXCEPTION 'Prerequisite migration missing: required RLS helper function can_access_account(uuid) not found. Run earlier RLS migrations before running this migration.';
  END IF;
END
$$;

-- ============================================================================
-- 1. Create spaces table
-- ============================================================================

CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  notes TEXT NULL,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  version INT NOT NULL DEFAULT 1,
  -- Unique name per scope (account + project combination)
  CONSTRAINT unique_space_name_per_scope UNIQUE (account_id, project_id, name)
);

-- ============================================================================
-- 2. Create indexes for spaces
-- ============================================================================

CREATE INDEX idx_spaces_account_id_project_id ON spaces(account_id, project_id);
CREATE INDEX idx_spaces_account_id_archived ON spaces(account_id, is_archived);
CREATE INDEX idx_spaces_project_id ON spaces(project_id) WHERE project_id IS NOT NULL;

-- ============================================================================
-- 3. Add space_id column to items table
-- ============================================================================

ALTER TABLE items ADD COLUMN space_id UUID NULL REFERENCES spaces(id) ON DELETE SET NULL;
CREATE INDEX idx_items_space_id ON items(space_id);

-- ============================================================================
-- 4. Enable RLS on spaces table
-- ============================================================================

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. Create RLS policies for spaces
-- ============================================================================

-- Users can read spaces in their account or owners can read all
CREATE POLICY "Users can read spaces in their account or owners can read all"
  ON spaces FOR SELECT
  USING (can_access_account(account_id) OR is_system_owner());

-- Users can create spaces in their account or owners can create any
CREATE POLICY "Users can create spaces in their account or owners can create any"
  ON spaces FOR INSERT
  WITH CHECK (can_access_account(account_id) OR is_system_owner());

-- Users can update spaces in their account or owners can update any
CREATE POLICY "Users can update spaces in their account or owners can update any"
  ON spaces FOR UPDATE
  USING (can_access_account(account_id) OR is_system_owner())
  WITH CHECK (can_access_account(account_id) OR is_system_owner());

-- Users can delete spaces in their account or owners can delete any
CREATE POLICY "Users can delete spaces in their account or owners can delete any"
  ON spaces FOR DELETE
  USING (can_access_account(account_id) OR is_system_owner());

-- ============================================================================
-- 6. Add comments
-- ============================================================================

COMMENT ON TABLE spaces IS 'Stores canonical Spaces (name, notes, gallery) scoped to an account, optionally to a project. NULL project_id = account-wide space.';
COMMENT ON COLUMN spaces.project_id IS 'NULL = account-wide space, UUID = project-specific space';
COMMENT ON COLUMN spaces.images IS 'JSONB array of ItemImage objects; isPrimary determines representative image';
COMMENT ON COLUMN items.space_id IS 'Foreign key to spaces table. Replaces items.space string field.';
