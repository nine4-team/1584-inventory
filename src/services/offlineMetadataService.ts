import { offlineStore } from './offlineStore'
import { supabase } from './supabase'
import { convertTimestamps, ensureAuthenticatedForDatabase } from './databaseService'
import { BudgetCategory, TaxPreset } from '@/types'
import { isNetworkOnline } from './networkStatusService'
import { DEFAULT_TAX_PRESETS } from '@/constants/taxPresets'

/**
 * Offline Metadata Service
 * 
 * Provides caching and retrieval of budget categories and tax presets
 * for offline validation and UI rendering.
 */

/**
 * Cache budget categories for an account to IndexedDB
 * Fetches directly from Supabase to avoid circular dependency with budgetCategoriesService
 */
export async function cacheBudgetCategoriesOffline(accountId: string): Promise<void> {
  try {
    await offlineStore.init()
    
    // Only cache when online
    if (!isNetworkOnline()) {
      console.warn('[offlineMetadataService] Cannot cache budget categories while offline')
      return
    }

    // Fetch directly from Supabase to avoid circular dependency
    await ensureAuthenticatedForDatabase()
    
    const { data, error } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_archived', false)

    if (error) {
      throw error
    }

    // Convert to DB format
    const dbCategories = (data || []).map(category => {
      const converted = convertTimestamps(category)
      return {
        id: converted.id,
        accountId: converted.account_id,
        name: converted.name,
        slug: converted.slug,
        isArchived: converted.is_archived || false,
        metadata: converted.metadata || null,
        createdAt: converted.created_at instanceof Date ? converted.created_at.toISOString() : converted.created_at,
        updatedAt: converted.updated_at instanceof Date ? converted.updated_at.toISOString() : converted.updated_at,
      }
    })

    await offlineStore.saveBudgetCategories(accountId, dbCategories)
    
    // Emit telemetry event
    console.log('[offlineMetadataService] Budget categories cached', { 
      accountId, 
      count: dbCategories.length 
    })
    
    // Emit custom event for telemetry
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('offlineMetadataCacheWarm', {
        detail: { type: 'budgetCategories', accountId, count: dbCategories.length }
      }))
    }
  } catch (error) {
    console.error('[offlineMetadataService] Failed to cache budget categories:', error)
    throw error
  }
}

/**
 * Cache tax presets for an account to IndexedDB
 * Fetches directly from Supabase to avoid circular dependency with taxPresetsService
 */
export async function cacheTaxPresetsOffline(accountId: string): Promise<void> {
  try {
    await offlineStore.init()
    
    // Only cache when online
    if (!isNetworkOnline()) {
      console.warn('[offlineMetadataService] Cannot cache tax presets while offline')
      return
    }

    // Fetch directly from Supabase to avoid circular dependency
    await ensureAuthenticatedForDatabase()
    
    const { data, error } = await supabase
      .from('account_presets')
      .select('presets')
      .eq('account_id', accountId)
      .single()

    let presets: TaxPreset[] = DEFAULT_TAX_PRESETS

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
      throw error
    }

    if (data?.presets?.tax_presets && Array.isArray(data.presets.tax_presets)) {
      presets = data.presets.tax_presets as TaxPreset[]
    }
    
    await offlineStore.saveTaxPresets(accountId, presets)
    
    // Emit telemetry event
    console.log('[offlineMetadataService] Tax presets cached', { 
      accountId, 
      count: presets.length 
    })
    
    // Emit custom event for telemetry
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('offlineMetadataCacheWarm', {
        detail: { type: 'taxPresets', accountId, count: presets.length }
      }))
    }
  } catch (error) {
    console.error('[offlineMetadataService] Failed to cache tax presets:', error)
    throw error
  }
}

/**
 * Hydrate all metadata caches for an account
 */
export async function hydrateMetadataCaches(accountId: string): Promise<void> {
  try {
    await Promise.all([
      cacheBudgetCategoriesOffline(accountId),
      cacheTaxPresetsOffline(accountId)
    ])
  } catch (error) {
    console.error('[offlineMetadataService] Failed to hydrate metadata caches:', error)
    throw error
  }
}

/**
 * Get a cached budget category by ID
 */
export async function getCachedBudgetCategoryById(
  accountId: string,
  categoryId: string
): Promise<BudgetCategory | null> {
  try {
    await offlineStore.init()
    const dbCategory = await offlineStore.getBudgetCategoryById(accountId, categoryId)
    
    if (!dbCategory) {
      return null
    }

    // Convert from DB format to app format
    return {
      id: dbCategory.id,
      accountId: dbCategory.accountId,
      name: dbCategory.name,
      slug: dbCategory.slug,
      isArchived: dbCategory.isArchived,
      metadata: dbCategory.metadata ?? null,
      createdAt: new Date(dbCategory.createdAt),
      updatedAt: new Date(dbCategory.updatedAt),
    }
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to get cached budget category:', error)
    return null
  }
}

/**
 * Get all cached budget categories for an account
 */
export async function getCachedBudgetCategories(accountId: string): Promise<BudgetCategory[]> {
  try {
    await offlineStore.init()
    const dbCategories = await offlineStore.getBudgetCategories(accountId)
    
    // Convert from DB format to app format
    return dbCategories.map(dbCat => ({
      id: dbCat.id,
      accountId: dbCat.accountId,
      name: dbCat.name,
      slug: dbCat.slug,
      isArchived: dbCat.isArchived,
      metadata: dbCat.metadata ?? null,
      createdAt: new Date(dbCat.createdAt),
      updatedAt: new Date(dbCat.updatedAt),
    }))
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to get cached budget categories:', error)
    return []
  }
}

/**
 * Get a cached tax preset by ID
 */
export async function getCachedTaxPresetById(
  accountId: string,
  presetId: string
): Promise<TaxPreset | null> {
  try {
    await offlineStore.init()
    const preset = await offlineStore.getTaxPresetById(accountId, presetId)
    return preset
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to get cached tax preset:', error)
    return null
  }
}

/**
 * Get all cached tax presets for an account
 */
export async function getCachedTaxPresets(accountId: string): Promise<TaxPreset[]> {
  try {
    await offlineStore.init()
    const presets = await offlineStore.getTaxPresets(accountId)
    return presets ?? []
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to get cached tax presets:', error)
    return []
  }
}

/**
 * Check if metadata caches are warm for an account
 */
export async function areMetadataCachesWarm(accountId: string): Promise<{
  budgetCategories: boolean
  taxPresets: boolean
}> {
  try {
    await offlineStore.init()
    const [categories, presets] = await Promise.all([
      offlineStore.getBudgetCategories(accountId),
      offlineStore.getTaxPresets(accountId)
    ])
    
    return {
      budgetCategories: categories.length > 0,
      taxPresets: presets !== null && presets.length > 0
    }
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to check cache warmth:', error)
    return {
      budgetCategories: false,
      taxPresets: false
    }
  }
}

/**
 * Clear metadata caches for an account
 */
export async function clearMetadataCaches(accountId: string): Promise<void> {
  try {
    await offlineStore.init()
    await Promise.all([
      offlineStore.clearBudgetCategories(accountId),
      offlineStore.clearTaxPresets(accountId)
    ])
  } catch (error) {
    console.error('[offlineMetadataService] Failed to clear metadata caches:', error)
    throw error
  }
}
