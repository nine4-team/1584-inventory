-- Create space_templates table and (optional) spaces.template_id back-reference
-- Prereqs: can_access_account(uuid) and is_system_owner() must exist (same as spaces migration)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'can_access_account'
  ) THEN
    RAISE EXCEPTION 'Prerequisite migration missing: required RLS helper function can_access_account(uuid) not found.';
  END IF;
END
$$;

-- 1) Create table
CREATE TABLE space_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  version INT NOT NULL DEFAULT 1
);

-- 2) Indexes + uniqueness rules
CREATE INDEX idx_space_templates_account_id ON space_templates(account_id);
CREATE INDEX idx_space_templates_account_id_archived ON space_templates(account_id, is_archived);

-- Uniqueness (JR-proof rule):
-- - Active templates must have unique names per account (case-insensitive)
-- - Archived templates DO NOT block name reuse
CREATE UNIQUE INDEX space_templates_unique_active_name
  ON space_templates(account_id, lower(trim(name)))
  WHERE is_archived = false;

-- 3) Enable RLS + policies (mirror spaces policies)
ALTER TABLE space_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read space_templates in their account or owners can read all"
  ON space_templates FOR SELECT
  USING (can_access_account(account_id) OR is_system_owner());

CREATE POLICY "Users can create space_templates in their account or owners can create any"
  ON space_templates FOR INSERT
  WITH CHECK (can_access_account(account_id) OR is_system_owner());

CREATE POLICY "Users can update space_templates in their account or owners can update any"
  ON space_templates FOR UPDATE
  USING (can_access_account(account_id) OR is_system_owner())
  WITH CHECK (can_access_account(account_id) OR is_system_owner());

CREATE POLICY "Users can delete space_templates in their account or owners can delete any"
  ON space_templates FOR DELETE
  USING (can_access_account(account_id) OR is_system_owner());

-- 4) Optional provenance: spaces.template_id
ALTER TABLE spaces ADD COLUMN template_id UUID NULL REFERENCES space_templates(id) ON DELETE SET NULL;
CREATE INDEX idx_spaces_template_id ON spaces(template_id);

COMMENT ON TABLE space_templates IS 'Account-scoped definitions for creating project spaces. Archived templates are hidden from pickers.';
COMMENT ON COLUMN spaces.template_id IS 'Optional provenance back-reference: set when a space is created from a template.';
