import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/AccountContext'
import { useNetworkState } from './useNetworkState'
import {
  areMetadataCachesWarm,
  hydrateMetadataCaches,
  getCachedBudgetCategories,
  getCachedTaxPresets,
  getCachedVendorDefaults
} from '@/services/offlineMetadataService'

export type OfflinePrerequisiteStatus = 'ready' | 'warming' | 'blocked'

export interface OfflinePrerequisitesResult {
  isReady: boolean
  status: OfflinePrerequisiteStatus
  blockingReason: string | null
  hydrateNow: () => Promise<void>
  budgetCategories: boolean
  taxPresets: boolean
  vendorDefaults: boolean
}

/**
 * Hook to check offline prerequisites (budget categories and tax presets)
 * 
 * Returns:
 * - isReady: true if all prerequisites are cached
 * - status: 'ready' | 'warming' | 'blocked'
 * - blockingReason: human-readable reason if blocked
 * - hydrateNow: function to manually trigger cache hydration
 * - budgetCategories: whether budget categories cache is warm
 * - taxPresets: whether tax presets cache is warm
 */
export function useOfflinePrerequisites(): OfflinePrerequisitesResult {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const { isOnline } = useNetworkState()
  const [status, setStatus] = useState<OfflinePrerequisiteStatus>('ready')
  const [blockingReason, setBlockingReason] = useState<string | null>(null)
  const [budgetCategories, setBudgetCategories] = useState(false)
  const [taxPresets, setTaxPresets] = useState(false)
  const [vendorDefaults, setVendorDefaults] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)

  const checkCacheWarmth = useCallback(async (accountId: string) => {
    try {
      const warmth = await areMetadataCachesWarm(accountId)
      setBudgetCategories(warmth.budgetCategories)
      setTaxPresets(warmth.taxPresets)
      setVendorDefaults(warmth.vendorDefaults)

      // Determine status
      if (warmth.budgetCategories && warmth.taxPresets && warmth.vendorDefaults) {
        setStatus('ready')
        setBlockingReason(null)
      } else {
        const missing: string[] = []
        if (!warmth.budgetCategories) missing.push('budget categories')
        if (!warmth.taxPresets) missing.push('tax presets')
        if (!warmth.vendorDefaults) missing.push('vendor defaults')
        
        if (isOnline) {
          setStatus('warming')
          setBlockingReason(`Syncing ${missing.join(' and ')}...`)
        } else {
          setStatus('blocked')
          setBlockingReason(`Need ${missing.join(' and ')} synced to finish this offline. Go online and tap Retry sync.`)
        }
      }
    } catch (error) {
      console.error('[useOfflinePrerequisites] Failed to check cache warmth:', error)
      setStatus('blocked')
      setBlockingReason('Unable to verify offline prerequisites')
    }
  }, [isOnline])

  const hydrateNow = useCallback(async () => {
    if (!currentAccountId || !isOnline) {
      return
    }

    setIsHydrating(true)
    try {
      await hydrateMetadataCaches(currentAccountId)
      await checkCacheWarmth(currentAccountId)
      
      // Emit telemetry event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('offlineMetadataCacheWarm', {
          detail: { accountId: currentAccountId, source: 'manual' }
        }))
      }
    } catch (error) {
      console.error('[useOfflinePrerequisites] Failed to hydrate:', error)
      
      // Emit telemetry event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('offlineMetadataValidationBlocked', {
          detail: { accountId: currentAccountId, error: String(error) }
        }))
      }
    } finally {
      setIsHydrating(false)
    }
  }, [currentAccountId, isOnline, checkCacheWarmth])

  useEffect(() => {
    if (accountLoading || !currentAccountId) {
      return
    }

    checkCacheWarmth(currentAccountId)
  }, [currentAccountId, accountLoading, checkCacheWarmth])

  // Auto-hydrate when online if caches are cold
  useEffect(() => {
    if (accountLoading || !currentAccountId || !isOnline || isHydrating) {
      return
    }

    if (status === 'blocked' || (!budgetCategories || !taxPresets || !vendorDefaults)) {
      // Auto-hydrate in background
      hydrateMetadataCaches(currentAccountId).then(() => {
        checkCacheWarmth(currentAccountId)
      }).catch((error) => {
        console.warn('[useOfflinePrerequisites] Background hydration failed:', error)
        
        // Emit telemetry event
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('offlineMetadataCacheCold', {
            detail: { accountId: currentAccountId, error: String(error) }
          }))
        }
      })
    }
  }, [currentAccountId, isOnline, status, budgetCategories, taxPresets, vendorDefaults, accountLoading, isHydrating, checkCacheWarmth])

  const isReady = status === 'ready' && budgetCategories && taxPresets && vendorDefaults

  return {
    isReady,
    status: isHydrating ? 'warming' : status,
    blockingReason,
    hydrateNow,
    budgetCategories,
    taxPresets,
    vendorDefaults
  }
}
