-- Consolidate business_name into name field
-- This migration merges the redundant business_name column into the name column
-- and removes the business_name column entirely

-- Step 1: Update name with business_name values where they differ
-- This preserves any custom business names that were set
UPDATE accounts
SET 
  name = COALESCE(business_name, name)
WHERE business_name IS NOT NULL 
  AND business_name != name;

-- Step 2: Drop the business_name column
-- The name field now serves as both account name and business name
ALTER TABLE accounts DROP COLUMN IF EXISTS business_name;

-- Step 3: Update the comment on the name column to reflect its dual purpose
COMMENT ON COLUMN accounts.name IS 'Account name and business name (consolidated from business_name)';
