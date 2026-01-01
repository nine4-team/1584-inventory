-- Migration: Add version and updated_by columns for offline functionality
-- This migration adds version and updated_by columns to mutable tables that need
-- conflict resolution and offline write support.

-- ============================================================================
-- 1. Add version and updated_by columns to projects table
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id);

-- Add index on version for conflict detection queries
CREATE INDEX IF NOT EXISTS idx_projects_version ON public.projects(version);

-- ============================================================================
-- 2. Add version column to business_profiles table (updated_by already exists)
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Add index on version for conflict detection queries
CREATE INDEX IF NOT EXISTS idx_business_profiles_version ON public.business_profiles(version);

-- ============================================================================
-- 3. Add version and updated_by columns to budget_categories table
-- ============================================================================

ALTER TABLE public.budget_categories
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.budget_categories
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id);

-- Add index on version for conflict detection queries
CREATE INDEX IF NOT EXISTS idx_budget_categories_version ON public.budget_categories(version);

-- ============================================================================
-- 4. Backfill updated_by columns with created_by where appropriate
-- ============================================================================

-- Projects: Set updated_by to created_by for existing records
UPDATE public.projects
SET updated_by = created_by
WHERE updated_by IS NULL AND created_by IS NOT NULL;

-- Budget categories: Set updated_by to NULL for existing records (no created_by to reference)
-- This is acceptable as these are existing records without version tracking

-- ============================================================================
-- 5. Update RLS policies to allow queued writes with matching updated_by
-- ============================================================================

-- Items table: Drop old offline operation policies and update main policy
-- This allows offline-queued writes to succeed when the user's ID matches
DROP POLICY IF EXISTS "Account members can update items or offline operations" ON items;
DROP POLICY IF EXISTS "Users can update items in their account or owners can update any" ON items;
CREATE POLICY "Users can update items in their account or owners can update any"
  ON items FOR UPDATE
  USING (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  )
  WITH CHECK (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  );

-- Transactions table: Drop old offline operation policies and update main policy
DROP POLICY IF EXISTS "Account members can update transactions or offline operations" ON transactions;
DROP POLICY IF EXISTS "Users can update transactions in their account or owners can update any" ON transactions;
CREATE POLICY "Users can update transactions in their account or owners can update any"
  ON transactions FOR UPDATE
  USING (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  )
  WITH CHECK (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  );

-- Projects table: Allow updates when updated_by matches the authenticated user
DROP POLICY IF EXISTS "Users can update projects in their account or owners can update any" ON projects;
CREATE POLICY "Users can update projects in their account or owners can update any"
  ON projects FOR UPDATE
  USING (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  )
  WITH CHECK (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  );

-- Business profiles table: Allow updates when updated_by matches the authenticated user
DROP POLICY IF EXISTS "Users can update business profiles in their account or owners can update any" ON business_profiles;
CREATE POLICY "Users can update business profiles in their account or owners can update any"
  ON business_profiles FOR UPDATE
  USING (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  )
  WITH CHECK (
    can_access_account(account_id) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  );

-- Budget categories table: Allow updates when updated_by matches the authenticated user
-- Note: This policy also checks is_account_admin, but we add updated_by check for offline support
DROP POLICY IF EXISTS "Account admins can update budget categories in their account or owners can update any" ON budget_categories;
CREATE POLICY "Account admins can update budget categories in their account or owners can update any"
  ON budget_categories FOR UPDATE
  USING (
    (can_access_account(account_id) AND is_account_admin(account_id)) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  )
  WITH CHECK (
    (can_access_account(account_id) AND is_account_admin(account_id)) OR 
    is_system_owner() OR
    (updated_by IS NOT NULL AND updated_by = auth.uid() AND can_access_account(account_id))
  );

-- ============================================================================
-- 6. Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN public.projects.version IS 'Version number for conflict detection in offline scenarios';
COMMENT ON COLUMN public.projects.updated_by IS 'User ID who last updated this project, used for offline write authorization';
COMMENT ON COLUMN public.business_profiles.version IS 'Version number for conflict detection in offline scenarios';
COMMENT ON COLUMN public.budget_categories.version IS 'Version number for conflict detection in offline scenarios';
COMMENT ON COLUMN public.budget_categories.updated_by IS 'User ID who last updated this category, used for offline write authorization';
