-- Phase 5: Final sync and drop dual-write triggers
-- This migration performs a final sync from business_profiles to accounts,
-- then drops the dual-write triggers since we're ready to decommission business_profiles

-- Step 1: Final sync - copy any remaining differences from business_profiles to accounts
-- This ensures accounts table has the latest data before we drop business_profiles
UPDATE accounts a
SET 
  business_name = COALESCE(bp.name, a.business_name, a.name),
  business_logo_url = COALESCE(bp.logo_url, a.business_logo_url),
  business_profile_updated_at = COALESCE(
    GREATEST(
      bp.updated_at,
      a.business_profile_updated_at,
      a.created_at
    ),
    a.created_at
  ),
  business_profile_updated_by = COALESCE(bp.updated_by, a.business_profile_updated_by),
  business_profile_version = COALESCE(
    GREATEST(bp.version, a.business_profile_version, 1),
    1
  )
FROM business_profiles bp
WHERE a.id = bp.account_id
  AND (
    -- Only update if there are actual differences
    a.business_name IS DISTINCT FROM COALESCE(bp.name, a.name) OR
    a.business_logo_url IS DISTINCT FROM bp.logo_url OR
    a.business_profile_version IS DISTINCT FROM COALESCE(bp.version, 1) OR
    a.business_profile_updated_at IS DISTINCT FROM COALESCE(bp.updated_at, a.created_at)
  );

-- Step 2: Ensure all accounts have at least business_name set
UPDATE accounts
SET 
  business_name = COALESCE(business_name, name),
  business_profile_updated_at = COALESCE(business_profile_updated_at, created_at),
  business_profile_version = COALESCE(business_profile_version, 1)
WHERE business_name IS NULL;

-- Step 3: Drop the dual-write triggers
-- These are no longer needed since we're decommissioning business_profiles
DROP TRIGGER IF EXISTS trigger_sync_accounts_to_business_profiles ON accounts;
DROP TRIGGER IF EXISTS trigger_sync_business_profiles_to_accounts ON business_profiles;

-- Step 4: Drop the trigger functions (they're no longer needed)
DROP FUNCTION IF EXISTS sync_accounts_to_business_profiles();
DROP FUNCTION IF EXISTS sync_business_profiles_to_accounts();

-- Note: The business_profiles table, RLS policies, and indexes will be dropped in the next migration
-- This allows for a staged rollout and easy rollback if needed
