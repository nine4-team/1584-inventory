-- Phase 5: Drop business_profiles table, RLS policies, and indexes
-- This migration removes the business_profiles table entirely after verification
-- that all data has been migrated to accounts table

-- Step 1: Drop RLS policies on business_profiles
-- These policies are no longer needed since we're dropping the table
DROP POLICY IF EXISTS "Account members can read business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Users can create business profiles in their account or owners can create any" ON business_profiles;
DROP POLICY IF EXISTS "Users can update business profiles in their account or owners can update any" ON business_profiles;
DROP POLICY IF EXISTS "Users can delete business profiles in their account or owners can delete any" ON business_profiles;
DROP POLICY IF EXISTS "Account admins can insert business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Account admins can update business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Account admins can delete business profiles" ON business_profiles;

-- Step 2: Drop indexes on business_profiles
DROP INDEX IF EXISTS idx_business_profiles_account_id;

-- Step 3: Drop the business_profiles table
-- This will cascade delete any foreign key constraints
DROP TABLE IF EXISTS business_profiles CASCADE;

-- Step 4: Drop the verification functions (optional - can keep for historical reference)
-- Uncomment if you want to remove these functions as well:
-- DROP FUNCTION IF EXISTS verify_business_profile_consistency();
-- DROP FUNCTION IF EXISTS get_business_profile_consistency_summary();

-- Note: After this migration, all business profile data lives exclusively on the accounts table.
-- Update application code to remove any references to business_profiles table.
