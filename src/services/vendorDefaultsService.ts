import { TRANSACTION_SOURCES } from '@/constants/transactionSources'
import { getAccountPresets, mergeAccountPresetsSection } from './accountPresetsService'
import { isNetworkOnline } from './networkStatusService'
import { getCachedVendorDefaults, cacheVendorDefaultsOffline } from './offlineMetadataService'

export interface VendorSlot {
  id: string | null
  name: string | null
}

export interface VendorDefaultsResponse {
  slots: VendorSlot[]
}

/**
 * Get vendor defaults from Postgres for an account
 * Returns exactly 10 slots (may contain null values)
 * When offline, uses cached vendor defaults from IndexedDB
 */
export async function getVendorDefaults(accountId: string): Promise<VendorDefaultsResponse> {
  const online = isNetworkOnline()
  
  // When offline, try cache first
  if (!online) {
    const cached = await getCachedVendorDefaults(accountId)
    if (cached && cached.length === 10) {
      const slots: VendorSlot[] = cached.map(slot => {
        if (typeof slot === 'string') return { id: slot, name: slot }
        return { id: null, name: null }
      })
      return { slots }
    }
    // Cache is cold offline - log warning and return fallback
    console.warn('[vendorDefaultsService] Vendor defaults cache is cold while offline. Returning fallback.')
    const fallbackStored: Array<string | null> = TRANSACTION_SOURCES.slice(0, 10).map(name => name)
    while (fallbackStored.length < 10) {
      fallbackStored.push(null)
    }
    const fallbackSlots = fallbackStored.map(s => (s ? { id: s, name: s } : { id: null, name: null }))
    return { slots: fallbackSlots }
  }

  try {
    // Read canonical vendor_defaults from account_presets
    const ap = await getAccountPresets(accountId)
    const migrated: any[] | undefined = ap?.presets?.vendor_defaults
    if (Array.isArray(migrated)) {
      const rawSlots: any[] = migrated.slice()
      while (rawSlots.length < 10) rawSlots.push(null)
      const truncated = rawSlots.slice(0, 10)
      const slots: VendorSlot[] = truncated.map(slot => {
        if (typeof slot === 'string') return { id: slot, name: slot }
        return { id: null, name: null }
      })

      const storedSlots: Array<string | null> = truncated.map(slot =>
        typeof slot === 'string' ? slot : null
      )
      cacheVendorDefaultsOffline(accountId, storedSlots).catch(err => {
        console.warn('[vendorDefaultsService] Failed to cache vendor defaults:', err)
      })
      
      return { slots }
    }

    // If missing, return defaults without writing (no write-on-read)
    // The section will be initialized when user explicitly saves vendor defaults
    const initialStoredSlots: Array<string | null> = TRANSACTION_SOURCES.slice(0, 10).map(name => name)
    while (initialStoredSlots.length < 10) initialStoredSlots.push(null)
    const initialSlots = initialStoredSlots.map(s => (s ? { id: s, name: s } : { id: null, name: null }))
    
    cacheVendorDefaultsOffline(accountId, initialStoredSlots).catch(err => {
      console.warn('[vendorDefaultsService] Failed to cache vendor defaults:', err)
    })
    
    return { slots: initialSlots }
  } catch (error) {
    console.error('Error fetching vendor defaults from Postgres:', error)
    
    // Try cache as fallback when online fetch fails
    const cached = await getCachedVendorDefaults(accountId)
    if (cached && cached.length === 10) {
      const slots: VendorSlot[] = cached.map(slot => {
        if (typeof slot === 'string') return { id: slot, name: slot }
        return { id: null, name: null }
      })
      return { slots }
    }
    
    // Fallback to first 10 from TRANSACTION_SOURCES
    const fallbackStored: Array<string | null> = TRANSACTION_SOURCES.slice(0, 10).map(name => name)
    while (fallbackStored.length < 10) {
      fallbackStored.push(null)
    }
    const fallbackSlots = fallbackStored.map(s => (s ? { id: s, name: s } : { id: null, name: null }))
    return { slots: fallbackSlots }
  }
}

/**
 * Update a single vendor slot (index 1-10)
 * @param accountId Account ID
 * @param slotIndex Slot index (1-10)
 * @param vendorId Vendor name/id or null to clear
 */
export async function updateVendorSlot(
  accountId: string,
  slotIndex: number,
  vendorId: string | null,
  updatedBy?: string
): Promise<void> {
  if (slotIndex < 1 || slotIndex > 10) {
    throw new Error('Slot index must be between 1 and 10')
  }

  try {
    // Get current slots (normalized)
    const current = await getVendorDefaults(accountId)
    // Convert to stored-format array (string | null)
    const storedSlots: Array<string | null> = current.slots.map(s => (s.id ? s.id : null))

    // Update the specific slot (1-based -> 0-based)
    storedSlots[slotIndex - 1] = vendorId ? vendorId : null

    // Update all slots in stored-format
    await updateVendorDefaults(accountId, storedSlots, updatedBy)
  } catch (error) {
    console.error('Error updating vendor slot:', error)
    throw error
  }
}

/**
 * Update all vendor defaults in Postgres for an account
 * @param accountId Account ID
 * @param slots Array of exactly 10 vendor slots
 * @param updatedBy Optional user ID who made the update
 */
export async function updateVendorDefaults(
  accountId: string,
  slots: Array<string | null>,
  updatedBy?: string
): Promise<void> {
  try {
    // Validate slots
    if (!Array.isArray(slots)) {
      throw new Error('Slots must be an array')
    }

    if (slots.length !== 10) {
      throw new Error('Must have exactly 10 slots')
    }

    // Normalize slots to stored-format: plain strings or null
    const storedSlots: Array<string | null> = slots.map(slot => {
      if (typeof slot === 'string') {
        return slot
      }
      if (slot === null) {
        return null
      }
      // Reject any non-string/non-null input to enforce no backwards compatibility
      throw new Error('Slots must be plain strings or null (legacy object formats are not supported)')
    })
    // Persist exclusively to canonical account_presets using merge
    // This ensures budget_categories and other sections are preserved
    await mergeAccountPresetsSection(accountId, 'vendor_defaults', storedSlots)
    console.log('Vendor defaults updated successfully (account_presets)')
    
    // Update cache after successful update
    if (isNetworkOnline()) {
      cacheVendorDefaultsOffline(accountId, storedSlots).catch(err => {
        console.warn('[vendorDefaultsService] Failed to cache updated vendor defaults:', err)
      })
    }
  } catch (error) {
    console.error('Error updating vendor defaults:', error)
    throw error
  }
}

/**
 * Get list of available vendors (non-null slots) for transaction forms
 * This filters out empty slots and returns only configured vendors
 */
export async function getAvailableVendors(accountId: string): Promise<string[]> {
  const defaults = await getVendorDefaults(accountId)
  return defaults.slots
    .filter(slot => slot.id && slot.name)
    .map(slot => slot.name!)
}

