-- Phase 4: Verification - Consistency check function
-- This function compares business_profiles and accounts tables to detect any divergence
-- Can be run manually or scheduled for nightly checks

CREATE OR REPLACE FUNCTION verify_business_profile_consistency()
RETURNS TABLE (
  account_id UUID,
  issue_type TEXT,
  accounts_business_name TEXT,
  profiles_name TEXT,
  accounts_logo_url TEXT,
  profiles_logo_url TEXT,
  accounts_version INTEGER,
  profiles_version INTEGER,
  accounts_updated_at TIMESTAMPTZ,
  profiles_updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH account_profiles AS (
    SELECT 
      a.id as account_id,
      a.business_name,
      a.business_logo_url,
      a.business_profile_version,
      a.business_profile_updated_at,
      bp.name as profile_name,
      bp.logo_url as profile_logo_url,
      bp.version as profile_version,
      bp.updated_at as profile_updated_at
    FROM accounts a
    LEFT JOIN business_profiles bp ON a.id = bp.account_id
  )
  SELECT 
    ap.account_id,
    CASE 
      WHEN ap.profile_name IS NULL AND ap.business_name IS NOT NULL THEN 'missing_in_profiles'
      WHEN ap.business_name IS NULL AND ap.profile_name IS NOT NULL THEN 'missing_in_accounts'
      WHEN ap.business_name IS DISTINCT FROM ap.profile_name THEN 'name_mismatch'
      WHEN ap.business_logo_url IS DISTINCT FROM ap.profile_logo_url THEN 'logo_mismatch'
      WHEN ap.business_profile_version IS DISTINCT FROM ap.profile_version THEN 'version_mismatch'
      WHEN ap.business_profile_updated_at IS DISTINCT FROM ap.profile_updated_at THEN 'timestamp_mismatch'
      ELSE 'no_issue'
    END as issue_type,
    ap.business_name as accounts_business_name,
    ap.profile_name as profiles_name,
    ap.business_logo_url as accounts_logo_url,
    ap.profile_logo_url as profiles_logo_url,
    ap.business_profile_version as accounts_version,
    ap.profile_version as profiles_version,
    ap.business_profile_updated_at as accounts_updated_at,
    ap.profile_updated_at as profiles_updated_at
  FROM account_profiles ap
  WHERE 
    -- Only report actual issues (not 'no_issue')
    CASE 
      WHEN ap.profile_name IS NULL AND ap.business_name IS NOT NULL THEN true
      WHEN ap.business_name IS NULL AND ap.profile_name IS NOT NULL THEN true
      WHEN ap.business_name IS DISTINCT FROM ap.profile_name THEN true
      WHEN ap.business_logo_url IS DISTINCT FROM ap.profile_logo_url THEN true
      WHEN ap.business_profile_version IS DISTINCT FROM ap.profile_version THEN true
      WHEN ap.business_profile_updated_at IS DISTINCT FROM ap.profile_updated_at THEN true
      ELSE false
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get summary statistics
CREATE OR REPLACE FUNCTION get_business_profile_consistency_summary()
RETURNS TABLE (
  total_accounts INTEGER,
  accounts_with_business_name INTEGER,
  accounts_with_business_logo INTEGER,
  profiles_count INTEGER,
  mismatches_count INTEGER,
  missing_in_profiles_count INTEGER,
  missing_in_accounts_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM accounts)::INTEGER as total_accounts,
    (SELECT COUNT(*) FROM accounts WHERE business_name IS NOT NULL)::INTEGER as accounts_with_business_name,
    (SELECT COUNT(*) FROM accounts WHERE business_logo_url IS NOT NULL)::INTEGER as accounts_with_business_logo,
    (SELECT COUNT(*) FROM business_profiles)::INTEGER as profiles_count,
    (SELECT COUNT(*) FROM verify_business_profile_consistency() WHERE issue_type != 'no_issue')::INTEGER as mismatches_count,
    (SELECT COUNT(*) FROM verify_business_profile_consistency() WHERE issue_type = 'missing_in_profiles')::INTEGER as missing_in_profiles_count,
    (SELECT COUNT(*) FROM verify_business_profile_consistency() WHERE issue_type = 'missing_in_accounts')::INTEGER as missing_in_accounts_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON FUNCTION verify_business_profile_consistency() IS 'Checks for inconsistencies between business_profiles and accounts tables. Returns rows with issues found.';
COMMENT ON FUNCTION get_business_profile_consistency_summary() IS 'Returns summary statistics about business profile consistency between accounts and business_profiles tables.';
