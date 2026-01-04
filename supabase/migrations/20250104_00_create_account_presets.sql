-- Create account_presets table if it doesn't exist
-- This table consolidates account-scoped presets including budget categories
-- It may have been created manually or in a previous migration

CREATE TABLE IF NOT EXISTS account_presets (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  default_category_id UUID REFERENCES budget_categories(id) ON DELETE SET NULL,
  presets JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_account_presets_account_id ON account_presets(account_id);
CREATE INDEX IF NOT EXISTS idx_account_presets_default_category_id ON account_presets(default_category_id);

-- Enable RLS if not already enabled
ALTER TABLE account_presets ENABLE ROW LEVEL SECURITY;

-- Create RLS policies if they don't exist
DO $$
BEGIN
  -- SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'account_presets' 
    AND policyname = 'Users can read account presets in their account or owners can read all'
  ) THEN
    CREATE POLICY "Users can read account presets in their account or owners can read all"
      ON account_presets FOR SELECT
      USING (can_access_account(account_id) OR is_system_owner());
  END IF;

  -- INSERT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'account_presets' 
    AND policyname = 'Users can create account presets in their account or owners can create any'
  ) THEN
    CREATE POLICY "Users can create account presets in their account or owners can create any"
      ON account_presets FOR INSERT
      WITH CHECK (can_access_account(account_id) OR is_system_owner());
  END IF;

  -- UPDATE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'account_presets' 
    AND policyname = 'Users can update account presets in their account or owners can update any'
  ) THEN
    CREATE POLICY "Users can update account presets in their account or owners can update any"
      ON account_presets FOR UPDATE
      USING (can_access_account(account_id) OR is_system_owner())
      WITH CHECK (can_access_account(account_id) OR is_system_owner());
  END IF;
END $$;

-- Add comments
COMMENT ON TABLE account_presets IS 'Consolidates account-scoped presets including budget categories, tax presets, and vendor defaults';
COMMENT ON COLUMN account_presets.default_category_id IS 'Default budget category ID for the account';
COMMENT ON COLUMN account_presets.presets IS 'JSONB object containing various presets. After migration, budget_categories array is stored here.';
