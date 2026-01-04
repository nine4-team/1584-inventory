import { supabase } from './supabase'
import { convertTimestamps } from './databaseService'
import { Account, User } from '@/types'

/**
 * Account Service - Simplified account management
 * Users belong to one account via user.account_id
 * System owners (user.role = 'owner') can access all accounts
 */
export const accountService = {
  /**
   * Create a new account (owners only)
   */
  async createAccount(name: string, createdBy: string): Promise<string> {
    const { data, error } = await supabase
      .from('accounts')
      .insert({
        name,
        created_by: createdBy,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single()

    if (error) throw error
    
    const accountId = data.id
    
    // Ensure default budget categories are created for the new account
    // This is a best-effort operation, so we don't throw if it fails
    try {
      const { budgetCategoriesService } = await import('./budgetCategoriesService')
      await budgetCategoriesService.ensureDefaultBudgetCategories(accountId)
    } catch (err) {
      console.warn(`[accountService] Failed to create default budget categories for account ${accountId}:`, err)
      // Don't throw - account creation succeeded, category seeding can be retried later
    }
    
    return accountId
  },

  /**
   * Get account details
   */
  async getAccount(accountId: string): Promise<Account | null> {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null
      }
      throw error
    }

    const accountData = convertTimestamps(data)
    return {
      id: accountData.id,
      name: accountData.name,
      createdAt: accountData.created_at,
      createdBy: accountData.created_by,
      businessLogoUrl: accountData.business_logo_url ?? null,
      businessProfileUpdatedAt: accountData.business_profile_updated_at ? new Date(accountData.business_profile_updated_at) : null,
      businessProfileUpdatedBy: accountData.business_profile_updated_by ?? null,
      businessProfileVersion: accountData.business_profile_version ?? null
    } as Account
  },

  /**
   * Get account for a user (from user.account_id)
   */
  async getUserAccount(userId: string): Promise<Account | null> {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('account_id')
      .eq('id', userId)
      .single()

    if (userError || !userData?.account_id) {
      return null
    }

    return await this.getAccount(userData.account_id)
  },

  /**
   * Assign user to an account
   */
  async assignUserToAccount(userId: string, accountId: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ account_id: accountId })
      .eq('id', userId)

    if (error) throw error
  },

  /**
   * Remove user from account (set account_id to null)
   */
  async removeUserFromAccount(userId: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ account_id: null })
      .eq('id', userId)

    if (error) throw error
  },

  /**
   * Get all users in an account
   */
  async getAccountUsers(accountId: string): Promise<User[]> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('account_id', accountId)

    if (error) throw error

    return (data || []).map(user => {
      const converted = convertTimestamps(user)
      return {
        id: converted.id,
        email: converted.email,
        fullName: converted.full_name,
        accountId: converted.account_id,
        role: converted.role || null,
        createdAt: converted.created_at ? new Date(converted.created_at) : new Date(),
        lastLogin: converted.last_login ? new Date(converted.last_login) : new Date()
      } as User
    })
  },

  /**
   * Check if user is member of account
   */
  async isAccountMember(userId: string, accountId: string): Promise<boolean> {
    // System owners can access any account
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, account_id')
      .eq('id', userId)
      .single()

    if (userError) {
      return false
    }

    // System owners can access all accounts
    if (userData.role === 'owner') {
      return true
    }

    // Regular users can only access their own account
    return userData.account_id === accountId
  },

  /**
   * Get all accounts (owners only)
   */
  async getAllAccounts(): Promise<Account[]> {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return (data || []).map(account => {
      const converted = convertTimestamps(account)
      return {
        id: converted.id,
        name: converted.name,
        createdAt: converted.created_at,
        createdBy: converted.created_by,
        businessLogoUrl: converted.business_logo_url ?? null,
        businessProfileUpdatedAt: converted.business_profile_updated_at ? new Date(converted.business_profile_updated_at) : null,
        businessProfileUpdatedBy: converted.business_profile_updated_by ?? null,
        businessProfileVersion: converted.business_profile_version ?? null
      } as Account
    })
  }
}

