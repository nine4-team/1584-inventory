-- Phase 2: Dual-write triggers to keep accounts and business_profiles in sync
-- These triggers ensure that updates to either table are reflected in both
-- during the transition period before business_profiles is decommissioned

-- Function to sync business profile data from accounts to business_profiles
CREATE OR REPLACE FUNCTION sync_accounts_to_business_profiles()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent recursive updates when triggers keep each other in sync
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Only sync if business_name or business_logo_url changed
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND 
     (NEW.business_name IS NOT NULL OR NEW.business_logo_url IS NOT NULL) THEN
    
    -- Insert or update business_profiles
    INSERT INTO business_profiles (
      account_id,
      name,
      logo_url,
      updated_at,
      updated_by,
      version
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.business_name, NEW.name),
      NEW.business_logo_url,
      COALESCE(NEW.business_profile_updated_at, NOW()),
      NEW.business_profile_updated_by,
      COALESCE(NEW.business_profile_version, 1)
    )
    ON CONFLICT (account_id) 
    DO UPDATE SET
      name = COALESCE(EXCLUDED.name, business_profiles.name),
      logo_url = EXCLUDED.logo_url,
      updated_at = COALESCE(EXCLUDED.updated_at, business_profiles.updated_at),
      updated_by = EXCLUDED.updated_by,
      version = COALESCE(EXCLUDED.version, business_profiles.version);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync business profile data from business_profiles to accounts
CREATE OR REPLACE FUNCTION sync_business_profiles_to_accounts()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent recursive updates when triggers keep each other in sync
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Update accounts with business_profiles data
  UPDATE accounts
  SET
    business_name = COALESCE(NEW.name, accounts.business_name, accounts.name),
    business_logo_url = NEW.logo_url,
    business_profile_updated_at = COALESCE(NEW.updated_at, accounts.business_profile_updated_at),
    business_profile_updated_by = NEW.updated_by,
    business_profile_version = COALESCE(NEW.version, accounts.business_profile_version)
  WHERE id = NEW.account_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: When accounts are updated, sync to business_profiles
DROP TRIGGER IF EXISTS trigger_sync_accounts_insert ON accounts;
CREATE TRIGGER trigger_sync_accounts_insert
  AFTER INSERT
  ON accounts
  FOR EACH ROW
  WHEN (
    NEW.business_name IS NOT NULL OR 
    NEW.business_logo_url IS NOT NULL OR
    NEW.business_profile_updated_at IS NOT NULL OR
    NEW.business_profile_updated_by IS NOT NULL OR
    NEW.business_profile_version IS NOT NULL
  )
  EXECUTE FUNCTION sync_accounts_to_business_profiles();

DROP TRIGGER IF EXISTS trigger_sync_accounts_update ON accounts;
CREATE TRIGGER trigger_sync_accounts_update
  AFTER UPDATE OF business_name, business_logo_url, business_profile_updated_at, business_profile_updated_by, business_profile_version
  ON accounts
  FOR EACH ROW
  WHEN (
    NEW.business_name IS DISTINCT FROM OLD.business_name OR
    NEW.business_logo_url IS DISTINCT FROM OLD.business_logo_url OR
    NEW.business_profile_updated_at IS DISTINCT FROM OLD.business_profile_updated_at OR
    NEW.business_profile_updated_by IS DISTINCT FROM OLD.business_profile_updated_by OR
    NEW.business_profile_version IS DISTINCT FROM OLD.business_profile_version
  )
  EXECUTE FUNCTION sync_accounts_to_business_profiles();

-- Trigger: When business_profiles are updated, sync to accounts
DROP TRIGGER IF EXISTS trigger_sync_business_profiles_to_accounts ON business_profiles;
CREATE TRIGGER trigger_sync_business_profiles_to_accounts
  AFTER INSERT OR UPDATE
  ON business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_business_profiles_to_accounts();

-- Note: These triggers use SECURITY DEFINER to bypass RLS, ensuring sync works
-- even if the user doesn't have direct access to both tables
