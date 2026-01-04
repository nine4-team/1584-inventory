# Task 3.4: Business Profile Service Migration

## Objective
Migrate the business profile service from Firestore to Supabase Postgres, and consolidate business profile data into the `accounts` table.

## Current State (Post-Consolidation)

**Business profile data now lives on the `accounts` table**, not a separate `business_profiles` table. This consolidation simplifies the data model and ensures business branding is immediately available.

### Schema

Business profile fields on `accounts` table:
- `business_name TEXT` - Business name for branding
- `business_logo_url TEXT` - URL to business logo
- `business_profile_updated_at TIMESTAMPTZ` - Timestamp when profile was last updated
- `business_profile_updated_by UUID` - User who last updated the profile
- `business_profile_version INTEGER` - Version number for conflict detection in offline scenarios

### Service Implementation

```typescript
import { supabase } from './supabase'
import { convertTimestamps } from './databaseService'
import { BusinessProfile } from '@/types'

/**
 * Business Profile Service - Manages business profile data for accounts
 * Reads exclusively from accounts table
 */
export const businessProfileService = {
  /**
   * Get business profile for an account
   * Reads from accounts table (business_name, business_logo_url, etc.)
   */
  async getBusinessProfile(accountId: string): Promise<BusinessProfile | null> {
    try {
      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('id, business_name, business_logo_url, business_profile_updated_at, business_profile_updated_by, business_profile_version, name')
        .eq('id', accountId)
        .single()

      if (accountError) {
        if (accountError.code === 'PGRST116') {
          return null
        }
        throw accountError
      }

      if (!accountData) {
        return null
      }

      // Use business_name if set, otherwise fall back to account name
      const profileData = convertTimestamps({
        business_name: accountData.business_name,
        business_logo_url: accountData.business_logo_url,
        business_profile_updated_at: accountData.business_profile_updated_at,
        business_profile_updated_by: accountData.business_profile_updated_by,
        business_profile_version: accountData.business_profile_version
      })
      
      return {
        accountId: accountData.id,
        name: accountData.business_name || accountData.name || '',
        logoUrl: accountData.business_logo_url,
        updatedAt: profileData.business_profile_updated_at ? new Date(profileData.business_profile_updated_at) : new Date(),
        updatedBy: profileData.business_profile_updated_by || ''
      } as BusinessProfile
    } catch (error) {
      console.error('Error fetching business profile:', error)
      return null
    }
  },

  /**
   * Update business profile for an account
   * Writes directly to accounts table
   */
  async updateBusinessProfile(
    accountId: string,
    name: string,
    logoUrl: string | null,
    updatedBy: string
  ): Promise<void> {
    try {
      // Get the current version to increment it properly
      const { data: currentAccount, error: fetchError } = await supabase
        .from('accounts')
        .select('business_profile_version')
        .eq('id', accountId)
        .single()

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError
      }

      const newVersion = (currentAccount?.business_profile_version || 0) + 1

      // Write to accounts table
      const { error } = await supabase
        .from('accounts')
        .update({
          business_name: name,
          business_logo_url: logoUrl,
          business_profile_updated_at: new Date().toISOString(),
          business_profile_updated_by: updatedBy,
          business_profile_version: newVersion
        })
        .eq('id', accountId)

      if (error) {
        throw error
      }

      console.log('Business profile updated successfully')
    } catch (error) {
      console.error('Error updating business profile:', error)
      throw error
    }
  }
}
```

## Key Changes

1. **Data Location**: 
   - Old: Separate `business_profiles` table
   - New: Columns on `accounts` table

2. **Query Pattern**: 
   - Old: `supabase.from('business_profiles').eq('account_id', accountId)`
   - New: `supabase.from('accounts').select('business_name, business_logo_url, ...').eq('id', accountId)`

3. **Fallback Logic**: 
   - If `business_name` is null, falls back to `accounts.name`
   - No separate table lookup needed

4. **Benefits**:
   - Simpler data model (one less table)
   - Business branding immediately available with account data
   - Better offline sync (account data includes business profile)
   - No dual-write complexity

## Migration History

The consolidation was completed in phases:
1. **Phase 1-3**: Added columns to accounts, backfilled data, updated application code
2. **Phase 4**: Verification and consistency checks
3. **Phase 5**: Final sync and decommissioned `business_profiles` table
4. **Phase 6**: Removed fallback logic and updated documentation

See `dev_docs/actively_implementing/business-profile-consolidation-plan.md` for full details.

## Verification
- [x] Can get business profile from accounts table
- [x] Can update business profile on accounts table
- [x] Logo URL handling works
- [x] Fallback to account name works when business_name is null
- [x] Offline caches use account data (no separate business_profiles table)

## Next Steps
- Proceed to Task 3.5: Tax Presets Service Migration

