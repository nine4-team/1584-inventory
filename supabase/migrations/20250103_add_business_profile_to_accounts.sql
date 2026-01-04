-- Phase 1: Add business profile columns to accounts table
-- This migration adds nullable columns to accounts to consolidate business_profiles data
-- These columns will be populated via backfill and dual-write triggers

-- Add business profile columns to accounts table
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS business_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS business_profile_updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS business_profile_updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS business_profile_version INTEGER DEFAULT 1;

-- Add index for business_profile_updated_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_accounts_business_profile_updated_at 
  ON accounts(business_profile_updated_at DESC);

-- Add index for business_profile_updated_by
CREATE INDEX IF NOT EXISTS idx_accounts_business_profile_updated_by 
  ON accounts(business_profile_updated_by);

-- Add comments for documentation
COMMENT ON COLUMN accounts.business_name IS 'Business name for branding (replaces business_profiles.name)';
COMMENT ON COLUMN accounts.business_logo_url IS 'URL to business logo (replaces business_profiles.logo_url)';
COMMENT ON COLUMN accounts.business_profile_updated_at IS 'Timestamp when business profile was last updated';
COMMENT ON COLUMN accounts.business_profile_updated_by IS 'User who last updated the business profile';
COMMENT ON COLUMN accounts.business_profile_version IS 'Version number for conflict detection in offline scenarios';

-- RLS policies already allow account admins to update accounts, which will include these new columns
-- No additional RLS policies needed as the existing UPDATE policy covers these columns
