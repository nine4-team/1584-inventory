import { offlineStore } from './offlineStore'
import { supabase } from './supabase'
import { convertTimestamps, ensureAuthenticatedForDatabase } from './databaseService'
import { BudgetCategory, TaxPreset } from '@/types'
import { isNetworkOnline } from './networkStatusService'
import { DEFAULT_TAX_PRESETS } from '@/constants/taxPresets'
import { TRANSACTION_SOURCES } from '@/constants/transactionSources'

const METADATA_HYDRATION_DEBOUNCE_MS = 30_000
const ongoingHydrations = new Map<string, Promise<void>>()
const lastHydrationAt = new Map<string, number>()

type CacheBudgetCategoriesOptions = {
  categories?: BudgetCategory[]
  force?: boolean
}

type CacheTaxPresetsOptions = {
  presets?: TaxPreset[]
  force?: boolean
}

type CacheVendorDefaultsOptions = {
  force?: boolean
}

type NormalizedBudgetCategory = {
  id: string
  accountId: string
  name: string
  slug: string
  isArchived: boolean
  metadata?: Record<string, any> | null
  createdAt: string
  updatedAt: string
}

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
export async function cacheBudgetCategoriesOffline(
  accountId: string,
  options: CacheBudgetCategoriesOptions = {}
): Promise<void> {
  try {
    await offlineStore.init()

    const { categories, force = false } = options
    let normalizedCategories: NormalizedBudgetCategory[] = []

    if (categories && categories.length > 0) {
      normalizedCategories = categories.map(category => ({
        id: category.id,
        accountId: category.accountId ?? accountId,
        name: category.name,
        slug: category.slug,
        isArchived: category.isArchived ?? false,
        metadata: category.metadata ?? null,
        createdAt: category.createdAt instanceof Date ? category.createdAt.toISOString() : String(category.createdAt),
        updatedAt: category.updatedAt instanceof Date ? category.updatedAt.toISOString() : String(category.updatedAt),
      }))
    } else {
      // Only fetch when online
      if (!isNetworkOnline()) {
        console.warn('[offlineMetadataService] Cannot cache budget categories while offline')
        return
      }

      // Fetch directly from Supabase to avoid circular dependency
      // Use view that reads from embedded categories in account_presets
      await ensureAuthenticatedForDatabase()
      
      const { data, error } = await supabase
        .from('vw_budget_categories')
        .select('*')
        .eq('account_id', accountId)
        .eq('is_archived', false)

      if (error) {
        throw error
      }

      normalizedCategories = (data || []).map(category => {
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
    }

    if (!force && normalizedCategories.length > 0) {
      const existing = await offlineStore.getBudgetCategories(accountId)
      if (
        existing.length > 0 &&
        areBudgetCategoriesEqual(existing, normalizedCategories)
      ) {
        console.debug('[offlineMetadataService] Budget categories cache already up to date, skipping write', {
          accountId,
          count: normalizedCategories.length
        })
        return
      }
    }

    await offlineStore.saveBudgetCategories(accountId, normalizedCategories)
    
    // Emit telemetry event
    console.log('[offlineMetadataService] Budget categories cached', { 
      accountId, 
      count: normalizedCategories.length 
    })
    
    // Emit custom event for telemetry
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('offlineMetadataCacheWarm', {
        detail: { type: 'budgetCategories', accountId, count: normalizedCategories.length }
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
export async function cacheTaxPresetsOffline(
  accountId: string,
  options: CacheTaxPresetsOptions = {}
): Promise<void> {
  try {
    await offlineStore.init()
    const { presets: providedPresets, force = false } = options
    let presets: TaxPreset[] | null = providedPresets ? providedPresets.slice() : null
    
    if (!presets) {
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

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        throw error
      }

      if (data?.presets?.tax_presets && Array.isArray(data.presets.tax_presets)) {
        presets = data.presets.tax_presets as TaxPreset[]
      } else {
        presets = DEFAULT_TAX_PRESETS
      }
    }

    const normalizedPresets = presets ?? DEFAULT_TAX_PRESETS

    if (!force) {
      const existing = await offlineStore.getTaxPresets(accountId)
      if (existing && areTaxPresetsEqual(existing, normalizedPresets)) {
        console.debug('[offlineMetadataService] Tax presets cache already up to date, skipping write', {
          accountId,
          count: normalizedPresets.length
        })
        return
      }
    }
    
    await offlineStore.saveTaxPresets(accountId, normalizedPresets)
    
    // Emit telemetry event
    console.log('[offlineMetadataService] Tax presets cached', { 
      accountId, 
      count: normalizedPresets.length 
    })
    
    // Emit custom event for telemetry
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('offlineMetadataCacheWarm', {
        detail: { type: 'taxPresets', accountId, count: normalizedPresets.length }
      }))
    }
  } catch (error) {
    console.error('[offlineMetadataService] Failed to cache tax presets:', error)
    throw error
  }
}

/**
 * Cache vendor defaults for an account to IndexedDB
 * Optionally accepts pre-fetched slots to avoid duplicate network calls
 */
export async function cacheVendorDefaultsOffline(
  accountId: string,
  slots?: Array<string | null>,
  options: CacheVendorDefaultsOptions = {}
): Promise<void> {
  try {
    await offlineStore.init()
    const { force = false } = options

    let normalizedSlots = slots?.slice()

    if (!normalizedSlots) {
      // Only fetch when online
      if (!isNetworkOnline()) {
        console.warn('[offlineMetadataService] Cannot cache vendor defaults while offline')
        return
      }

      await ensureAuthenticatedForDatabase()
      const { data, error } = await supabase
        .from('account_presets')
        .select('presets')
        .eq('account_id', accountId)
        .single()

      if (error && error.code !== 'PGRST116') {
        throw error
      }

      const fetchedSlots = Array.isArray(data?.presets?.vendor_defaults)
        ? (data?.presets?.vendor_defaults as Array<string | null>)
        : null

      if (fetchedSlots) {
        normalizedSlots = fetchedSlots.map(slot => (typeof slot === 'string' ? slot : null))
      } else {
        normalizedSlots = TRANSACTION_SOURCES.slice(0, 10).map(name => name)
      }
    }

    // Ensure exactly 10 slots of string | null
    const padded = normalizedSlots.map(slot => (typeof slot === 'string' ? slot : null))
    while (padded.length < 10) padded.push(null)
    const truncated = padded.slice(0, 10)
    const configuredCount = truncated.filter(s => s !== null).length

    if (!force) {
      const existing = await offlineStore.getVendorDefaults(accountId)
      if (existing && areVendorDefaultsEqual(existing, truncated)) {
        console.debug('[offlineMetadataService] Vendor defaults cache already up to date, skipping write', {
          accountId,
          count: configuredCount
        })
        return
      }
    }

    await offlineStore.saveVendorDefaults(accountId, truncated)

    console.log('[offlineMetadataService] Vendor defaults cached', {
      accountId,
      count: configuredCount
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('offlineMetadataCacheWarm', {
        detail: { type: 'vendorDefaults', accountId, count: configuredCount }
      }))
    }
  } catch (error) {
    console.error('[offlineMetadataService] Failed to cache vendor defaults:', error)
    throw error
  }
}

/**
 * Get cached vendor defaults for an account
 */
export async function getCachedVendorDefaults(accountId: string): Promise<Array<string | null> | null> {
  try {
    await offlineStore.init()
    return await offlineStore.getVendorDefaults(accountId)
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to get cached vendor defaults:', error)
    return null
  }
}

/**
 * Hydrate all metadata caches for an account
 */
export async function hydrateMetadataCaches(
  accountId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!accountId) {
    return
  }

  const { force = false } = options
  const lastRun = lastHydrationAt.get(accountId)
  if (!force && lastRun && Date.now() - lastRun < METADATA_HYDRATION_DEBOUNCE_MS) {
    return
  }

  const existingHydration = ongoingHydrations.get(accountId)
  if (existingHydration) {
    return existingHydration
  }

  const hydrationPromise = (async () => {
    if (!force) {
      const warmth = await areMetadataCachesWarm(accountId)
      if (warmth.budgetCategories && warmth.taxPresets && warmth.vendorDefaults) {
        lastHydrationAt.set(accountId, Date.now())
        return
      }
    }

    await Promise.all([
      cacheBudgetCategoriesOffline(accountId, { force }),
      cacheTaxPresetsOffline(accountId, { force }),
      cacheVendorDefaultsOffline(accountId, undefined, { force })
    ])

    lastHydrationAt.set(accountId, Date.now())
  })()

  ongoingHydrations.set(accountId, hydrationPromise)

  try {
    await hydrationPromise
  } catch (error) {
    console.error('[offlineMetadataService] Failed to hydrate metadata caches:', error)
    throw error
  } finally {
    ongoingHydrations.delete(accountId)
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
  vendorDefaults: boolean
}> {
  try {
    await offlineStore.init()
    const [categories, presets, vendorDefaults] = await Promise.all([
      offlineStore.getBudgetCategories(accountId),
      offlineStore.getTaxPresets(accountId),
      offlineStore.getVendorDefaults(accountId)
    ])
    
    return {
      budgetCategories: categories.length > 0,
      taxPresets: presets !== null && presets.length > 0,
      vendorDefaults: vendorDefaults !== null && vendorDefaults.length === 10
    }
  } catch (error) {
    console.warn('[offlineMetadataService] Failed to check cache warmth:', error)
    return {
      budgetCategories: false,
      taxPresets: false,
      vendorDefaults: false
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
      offlineStore.clearTaxPresets(accountId),
      offlineStore.clearVendorDefaults(accountId)
    ])
  } catch (error) {
    console.error('[offlineMetadataService] Failed to clear metadata caches:', error)
    throw error
  }
}

function areBudgetCategoriesEqual(
  existing: Array<NormalizedBudgetCategory & { cachedAt?: string }>,
  incoming: NormalizedBudgetCategory[]
): boolean {
  if (existing.length !== incoming.length) {
    return false
  }

  const sortById = <T extends { id: string }>(arr: T[]) =>
    [...arr].sort((a, b) => a.id.localeCompare(b.id))

  const existingSorted = sortById(existing)
  const incomingSorted = sortById(incoming)

  return incomingSorted.every((category, index) => {
    const previous = existingSorted[index]
    if (!previous) return false
    return (
      previous.id === category.id &&
      previous.accountId === category.accountId &&
      previous.name === category.name &&
      previous.slug === category.slug &&
      previous.isArchived === category.isArchived &&
      previous.createdAt === category.createdAt &&
      previous.updatedAt === category.updatedAt &&
      JSON.stringify(previous.metadata ?? null) === JSON.stringify(category.metadata ?? null)
    )
  })
}

function areTaxPresetsEqual(existing: TaxPreset[], incoming: TaxPreset[]): boolean {
  if (existing.length !== incoming.length) {
    return false
  }

  const sortById = <T extends { id: string }>(arr: T[]) =>
    [...arr].sort((a, b) => a.id.localeCompare(b.id))

  const existingSorted = sortById(existing)
  const incomingSorted = sortById(incoming)

  return incomingSorted.every((preset, index) => {
    const previous = existingSorted[index]
    if (!previous) return false
    return (
      previous.id === preset.id &&
      previous.name === preset.name &&
      Number(previous.rate) === Number(preset.rate)
    )
  })
}

function areVendorDefaultsEqual(existing: Array<string | null>, incoming: Array<string | null>): boolean {
  if (existing.length !== incoming.length) {
    return false
  }

  for (let i = 0; i < incoming.length; i += 1) {
    if ((existing[i] ?? null) !== (incoming[i] ?? null)) {
      return false
    }
  }

  return true
}
