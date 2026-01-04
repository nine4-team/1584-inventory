import { supabase } from './supabase'
import { convertTimestamps } from './databaseService'
import { BusinessProfile } from '@/types'

/**
 * Business Profile Service - Manages business profile data for accounts
 * 
 * Phase 6: Reads exclusively from accounts table (business_profiles table has been decommissioned)
 */
export const businessProfileService = {
  /**
   * Get business profile for an account
   * Reads from accounts table (name, business_logo_url, etc.)
   * Note: business_name has been consolidated into name
   */
  async getBusinessProfile(accountId: string): Promise<BusinessProfile | null> {
    try {
      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('id, name, business_logo_url, business_profile_updated_at, business_profile_updated_by, business_profile_version')
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

      // Use name field (which now serves as both account name and business name)
      const profileData = convertTimestamps({
        business_logo_url: accountData.business_logo_url,
        business_profile_updated_at: accountData.business_profile_updated_at,
        business_profile_updated_by: accountData.business_profile_updated_by,
        business_profile_version: accountData.business_profile_version
      })
      
      return {
        accountId: accountData.id,
        name: accountData.name || '',
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

      // Write to accounts table - update name field (which serves as business name)
      const { error } = await supabase
        .from('accounts')
        .update({
          name: name,
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

