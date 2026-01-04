-- Phase 2: Backfill business profile data from business_profiles to accounts
-- This migration copies existing business_profiles data into the new accounts columns
-- It's idempotent and safe to re-run

-- Backfill: Copy existing business_profiles data to accounts
UPDATE accounts a
SET 
  business_name = COALESCE(bp.name, a.business_name, a.name),
  business_logo_url = COALESCE(bp.logo_url, a.business_logo_url),
  business_profile_updated_at = COALESCE(bp.updated_at, a.business_profile_updated_at, a.created_at),
  business_profile_updated_by = COALESCE(bp.updated_by, a.business_profile_updated_by),
  business_profile_version = COALESCE(bp.version, a.business_profile_version, 1)
FROM business_profiles bp
WHERE a.id = bp.account_id
  AND (
    a.business_profile_updated_at IS NULL
    OR bp.updated_at IS NULL
    OR bp.updated_at > a.business_profile_updated_at
    OR a.business_name IS NULL
    OR a.business_name = a.name
  );

-- For accounts without business_profiles, set business_name to account name
UPDATE accounts
SET 
  business_name = name,
  business_profile_updated_at = created_at,
  business_profile_version = 1
WHERE business_name IS NULL;

-- Note: This backfill is idempotent - it only updates accounts where business_name is NULL
-- or matches the account name (indicating it hasn't been set from business_profiles yet)
