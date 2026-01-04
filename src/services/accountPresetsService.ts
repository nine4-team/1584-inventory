import { supabase } from './supabase'
import { convertTimestamps, ensureAuthenticatedForDatabase } from './databaseService'
import { offlineStore } from './offlineStore'
import { isNetworkOnline } from './networkStatusService'

export interface AccountPresets {
  defaultCategoryId?: string | null
  presets?: any
}

const ACCOUNT_PRESETS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24 hours
const cacheKeyForAccount = (accountId: string) => `account-presets:${accountId}`

async function getCachedAccountPresets(accountId: string): Promise<AccountPresets | null> {
  if (!accountId) return null
  try {
    await offlineStore.init()
    const cached = await offlineStore.getCachedData(cacheKeyForAccount(accountId))
    return (cached as AccountPresets) ?? null
  } catch (error) {
    console.warn('[accountPresetsService] Failed to read cached account presets:', error)
    return null
  }
}

async function cacheAccountPresets(accountId: string, presets: AccountPresets): Promise<void> {
  if (!accountId) return
  try {
    await offlineStore.init()
    await offlineStore.setCachedData(cacheKeyForAccount(accountId), presets, ACCOUNT_PRESETS_CACHE_TTL_MS)
  } catch (error) {
    console.warn('[accountPresetsService] Failed to cache account presets:', error)
  }
}

async function updateCachedAccountPresets(accountId: string, updates: Partial<AccountPresets>): Promise<void> {
  const existing = await getCachedAccountPresets(accountId)
  const merged: AccountPresets = {
    defaultCategoryId: updates.defaultCategoryId ?? existing?.defaultCategoryId ?? null,
    presets:
      updates.presets !== undefined
        ? updates.presets
        : existing?.presets ?? {}
  }
  await cacheAccountPresets(accountId, merged)
}

export async function getCachedDefaultCategory(accountId: string): Promise<string | null> {
  const cached = await getCachedAccountPresets(accountId)
  return cached?.defaultCategoryId ?? null
}

/**
 * Fetch account_presets row for the given account.
 * Returns null if not found.
 */
export async function getAccountPresets(accountId: string): Promise<AccountPresets | null> {
  if (!accountId) return null

  const online = isNetworkOnline()
  if (!online) {
    const cached = await getCachedAccountPresets(accountId)
    if (!cached) {
      console.warn('[accountPresetsService] Account presets cache is cold while offline')
    }
    return cached
  }

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
    const normalized: AccountPresets = {
      defaultCategoryId: converted.default_category_id || null,
      presets: converted.presets || {}
    }
    await cacheAccountPresets(accountId, normalized)
    return normalized
  } catch (err) {
    console.error('Error fetching account presets:', err)
    const cached = await getCachedAccountPresets(accountId)
    if (cached) {
      console.warn('[accountPresetsService] Falling back to cached account presets after fetch failure')
      return cached
    }
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

  await updateCachedAccountPresets(accountId, updates)
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


