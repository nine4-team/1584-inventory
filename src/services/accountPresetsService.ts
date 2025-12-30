import { supabase } from './supabase'
import { convertTimestamps, ensureAuthenticatedForDatabase } from './databaseService'

export interface AccountPresets {
  defaultCategoryId?: string | null
  presets?: any
}

/**
 * Fetch account_presets row for the given account.
 * Returns null if not found.
 */
export async function getAccountPresets(accountId: string): Promise<AccountPresets | null> {
  if (!accountId) return null
  try {
    const { data, error } = await supabase
      .from('account_presets')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }

    const converted: any = convertTimestamps(data)
    return {
      defaultCategoryId: converted.default_category_id || null,
      presets: converted.presets || {}
    }
  } catch (err) {
    console.error('Error fetching account presets:', err)
    return null
  }
}

/**
 * Upsert account_presets for an account. Allows partial updates.
 */
export async function upsertAccountPresets(accountId: string, updates: Partial<AccountPresets>): Promise<void> {
  await ensureAuthenticatedForDatabase()
  const payload: any = {
    account_id: accountId,
    updated_at: new Date().toISOString()
  }
  if (updates.defaultCategoryId !== undefined) payload.default_category_id = updates.defaultCategoryId
  if (updates.presets !== undefined) payload.presets = updates.presets

  const { error } = await supabase
    .from('account_presets')
    .upsert(payload, { onConflict: 'account_id' })

  if (error) throw error
}

export async function getDefaultCategory(accountId: string): Promise<string | null> {
  const ap = await getAccountPresets(accountId)
  return ap?.defaultCategoryId ?? null
}

export async function setDefaultCategory(accountId: string, categoryId: string | null): Promise<void> {
  await upsertAccountPresets(accountId, { defaultCategoryId: categoryId })
}

/**
 * Get the budget category order for an account
 * @param accountId - The account ID
 * @returns Array of category IDs in order, or null if not set
 */
export async function getBudgetCategoryOrder(accountId: string): Promise<string[] | null> {
  const ap = await getAccountPresets(accountId)
  const order = ap?.presets?.budget_category_order
  return Array.isArray(order) ? order : null
}

/**
 * Set the budget category order for an account
 * @param accountId - The account ID
 * @param categoryIds - Array of category IDs in the desired order
 */
export async function setBudgetCategoryOrder(accountId: string, categoryIds: string[]): Promise<void> {
  const ap = await getAccountPresets(accountId)
  const currentPresets = ap?.presets || {}
  const updatedPresets = {
    ...currentPresets,
    budget_category_order: categoryIds
  }
  await upsertAccountPresets(accountId, { presets: updatedPresets })
}


