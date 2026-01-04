import { DEFAULT_TAX_PRESETS, TaxPreset } from '@/constants/taxPresets'
import { getAccountPresets, mergeAccountPresetsSection } from './accountPresetsService'
import { cacheTaxPresetsOffline, getCachedTaxPresets } from './offlineMetadataService'
import { isNetworkOnline } from './networkStatusService'

/**
 * Get tax presets from Postgres for an account, falling back to defaults if not found
 */
export async function getTaxPresets(accountId: string): Promise<TaxPreset[]> {
  const online = isNetworkOnline()

  if (!online) {
    const cached = await getCachedTaxPresets(accountId)
    if (cached.length > 0) {
      return cached
    }
    console.warn('[taxPresetsService] Tax presets cache is empty while offline. Falling back to defaults.')
    return DEFAULT_TAX_PRESETS
  }

  try {
    // Read canonical presets from account_presets
    const ap = await getAccountPresets(accountId)
    const migrated: any = ap?.presets?.tax_presets
    if (Array.isArray(migrated) && migrated.length > 0) {
      const presets = migrated as TaxPreset[]

      // Background cache refresh when online
      if (isNetworkOnline()) {
        cacheTaxPresetsOffline(accountId, { presets }).catch((error) => {
          // Don't fail the request if caching fails
          console.warn('[taxPresetsService] Background cache refresh failed:', error)
        })
      }

      return presets
    }

    // If missing, return defaults without writing (no write-on-read)
    // The section will be initialized when user explicitly saves presets
    const presets = DEFAULT_TAX_PRESETS

    // Background cache refresh when online
    if (isNetworkOnline()) {
      cacheTaxPresetsOffline(accountId, { presets }).catch((error) => {
        // Don't fail the request if caching fails
        console.warn('[taxPresetsService] Background cache refresh failed:', error)
      })
    }

    return presets
  } catch (error) {
    console.error('Error fetching tax presets from Postgres:', error)
    const cached = await getCachedTaxPresets(accountId)
    if (cached.length > 0) {
      console.warn('[taxPresetsService] Returning cached tax presets after fetch failure')
      return cached
    }
    // Fallback to defaults on error
    return DEFAULT_TAX_PRESETS
  }
}

/**
 * Update tax presets in Postgres for an account
 * @param accountId Account ID
 * @param presets Array of tax presets to save
 */
export async function updateTaxPresets(accountId: string, presets: TaxPreset[]): Promise<void> {
  try {
    // Validate presets
    if (!Array.isArray(presets) || presets.length === 0) {
      throw new Error('Presets must be a non-empty array')
    }

    if (presets.length > 5) {
      throw new Error('Cannot have more than 5 tax presets')
    }

    // Validate each preset
    for (const preset of presets) {
      if (!preset.id || !preset.name || typeof preset.rate !== 'number') {
        throw new Error('Each preset must have id, name, and rate fields')
      }
      if (preset.rate < 0 || preset.rate > 100) {
        throw new Error('Tax rate must be between 0 and 100')
      }
    }

    // Check for duplicate IDs
    const ids = presets.map(p => p.id)
    if (new Set(ids).size !== ids.length) {
      throw new Error('Preset IDs must be unique')
    }

    // Persist exclusively to the canonical account_presets table using merge
    // This ensures budget_categories and other sections are preserved
    await mergeAccountPresetsSection(accountId, 'tax_presets', presets)
    console.log('Tax presets updated successfully (account_presets)')

    // Update offline cache when online
    if (isNetworkOnline()) {
      cacheTaxPresetsOffline(accountId, { presets }).catch((error) => {
        // Don't fail the update if caching fails
        console.warn('[taxPresetsService] Failed to update offline cache:', error)
      })
    }
  } catch (error) {
    console.error('Error updating tax presets:', error)
    throw error
  }
}

/**
 * Get a specific preset by ID for an account
 */
export async function getTaxPresetById(accountId: string, presetId: string): Promise<TaxPreset | null> {
  const presets = await getTaxPresets(accountId)
  return presets.find(p => p.id === presetId) || null
}

