import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccount } from './AccountContext'
import type { Item, Transaction } from '@/types'
import { transactionService, unifiedItemsService } from '@/services/inventoryService'
import { getNetworkStatusSnapshot, subscribeToNetworkStatus } from '@/services/networkStatusService'
import { onSyncEvent } from '@/services/serviceWorker'
import { registerBusinessInventoryRefreshCallback } from '@/utils/realtimeSnapshotUpdater'
import { mergeBusinessInventoryTransactions, refreshBusinessInventoryRealtimeSnapshot } from '@/utils/businessInventoryRefresh'

type BusinessInventoryRealtimeTelemetry = {
  activeChannelCount: number
  lastItemsRefreshAt: number | null
  lastTransactionsRefreshAt: number | null
  lastCollectionsRefreshAt: number | null
  lastDisconnectAt: number | null
  lastDisconnectReason: string | null
}

type BusinessInventorySnapshot = {
  items: Item[]
  transactions: Transaction[]
  isLoading: boolean
  error: string | null
  initialized: boolean
  telemetry: BusinessInventoryRealtimeTelemetry
}

type RefreshOptions = {
  force?: boolean
  accountId?: string
}

interface BusinessInventoryRealtimeContextValue {
  snapshot: BusinessInventorySnapshot
  refreshCollections: (options?: RefreshOptions) => Promise<void>
}

const BusinessInventoryRealtimeContext = createContext<BusinessInventoryRealtimeContextValue | undefined>(undefined)

const createDefaultTelemetry = (): BusinessInventoryRealtimeTelemetry => ({
  activeChannelCount: 0,
  lastItemsRefreshAt: null,
  lastTransactionsRefreshAt: null,
  lastCollectionsRefreshAt: null,
  lastDisconnectAt: null,
  lastDisconnectReason: null,
})

const createEmptySnapshot = (): BusinessInventorySnapshot => ({
  items: [],
  transactions: [],
  isLoading: false,
  error: null,
  initialized: false,
  telemetry: createDefaultTelemetry(),
})

interface ProviderProps {
  children: ReactNode
  refreshCooldownMs?: number
}

export function BusinessInventoryRealtimeProvider({ children, refreshCooldownMs = 1500 }: ProviderProps) {
  const { currentAccountId } = useAccount()
  const [snapshot, setSnapshot] = useState<BusinessInventorySnapshot>(() => createEmptySnapshot())
  const subscriptionsRef = useRef<{ itemsUnsubscribe?: () => void; transactionsUnsubscribe?: () => void }>({})
  const initializingRef = useRef(false)
  const previousAccountIdRef = useRef<string | null>(null)
  const previousOnlineStatusRef = useRef(getNetworkStatusSnapshot().isOnline)
  const refreshInFlightRef = useRef(false)
  const lastRefreshAtRef = useRef(0)
  const refreshTokenRef = useRef(0)
  const itemsRealtimeAtRef = useRef(0)
  const transactionsRealtimeAtRef = useRef(0)
  const inventoryRelatedTransactionsRef = useRef<Transaction[]>([])

  const applyTelemetryPatch = useCallback((patch: Partial<BusinessInventoryRealtimeTelemetry>) => {
    setSnapshot(entry => ({
      ...entry,
      telemetry: {
        ...entry.telemetry,
        ...patch,
      },
    }))
  }, [])

  const updateChannelTelemetry = useCallback(() => {
    const activeChannelCount =
      Number(Boolean(subscriptionsRef.current.itemsUnsubscribe)) +
      Number(Boolean(subscriptionsRef.current.transactionsUnsubscribe))
    applyTelemetryPatch({ activeChannelCount })
  }, [applyTelemetryPatch])

  const handleItemsChannelStatus = useCallback(
    (status: string, err?: unknown) => {
      if (status === 'SUBSCRIBED') {
        applyTelemetryPatch({ lastDisconnectAt: null, lastDisconnectReason: null })
        return
      }
      if (!['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) return

      const now = Date.now()
      const message =
        typeof err === 'object' && err && 'message' in err && typeof (err as { message?: string }).message === 'string'
          ? (err as { message: string }).message
          : ''
      const statusLabel = status.toLowerCase().replace(/_/g, ' ')
      const reason = `items channel ${statusLabel}${message ? ` — ${message}` : ''}`
      applyTelemetryPatch({ lastDisconnectAt: now, lastDisconnectReason: reason })
    },
    [applyTelemetryPatch]
  )

  const cleanupSubscriptions = useCallback(() => {
    const subs = subscriptionsRef.current
    if (!subs.itemsUnsubscribe && !subs.transactionsUnsubscribe) return

    try {
      subs.itemsUnsubscribe?.()
    } catch (error) {
      console.debug('BusinessInventoryRealtimeProvider: failed to unsubscribe items channel', error)
    }

    try {
      subs.transactionsUnsubscribe?.()
    } catch (error) {
      console.debug('BusinessInventoryRealtimeProvider: failed to unsubscribe transactions channel', error)
    }

    subscriptionsRef.current = {}
    applyTelemetryPatch({ activeChannelCount: 0 })
  }, [applyTelemetryPatch])

  const resetSnapshot = useCallback(() => {
    setSnapshot(createEmptySnapshot())
    inventoryRelatedTransactionsRef.current = []
    itemsRealtimeAtRef.current = 0
    transactionsRealtimeAtRef.current = 0
  }, [])

  const ensureSubscriptions = useCallback(
    (accountId: string, itemsSeed: Item[], businessInventoryTransactionsSeed: Transaction[]) => {
      if (subscriptionsRef.current.itemsUnsubscribe || subscriptionsRef.current.transactionsUnsubscribe) {
        return
      }

      const itemsUnsubscribe = unifiedItemsService.subscribeToBusinessInventoryItems(
        accountId,
        updatedItems => {
          const now = Date.now()
          itemsRealtimeAtRef.current = now
          setSnapshot(entry => ({
            ...entry,
            items: updatedItems,
            telemetry: {
              ...entry.telemetry,
              lastItemsRefreshAt: now,
              lastCollectionsRefreshAt: now,
            },
          }))
        },
        itemsSeed,
        {
          onStatusChange: handleItemsChannelStatus,
        }
      )

      const transactionsUnsubscribe = transactionService.subscribeToBusinessInventoryTransactions(
        accountId,
        updatedTransactions => {
          const now = Date.now()
          transactionsRealtimeAtRef.current = now
          const mergedTransactions = mergeBusinessInventoryTransactions(
            updatedTransactions,
            inventoryRelatedTransactionsRef.current
          )
          setSnapshot(entry => ({
            ...entry,
            transactions: mergedTransactions,
            telemetry: {
              ...entry.telemetry,
              lastTransactionsRefreshAt: now,
              lastCollectionsRefreshAt: now,
            },
          }))
        },
        businessInventoryTransactionsSeed
      )

      subscriptionsRef.current = {
        itemsUnsubscribe,
        transactionsUnsubscribe,
      }
      updateChannelTelemetry()
    },
    [handleItemsChannelStatus, updateChannelTelemetry]
  )

  const refreshCollections = useCallback(
    async (options?: RefreshOptions) => {
      const accountId = options?.accountId ?? currentAccountId
      if (!accountId) return
      if (options?.accountId && options.accountId !== currentAccountId) return

      const now = Date.now()
      if (!options?.force) {
        if (refreshInFlightRef.current) return
        if (now - lastRefreshAtRef.current < refreshCooldownMs) return
      }

      refreshInFlightRef.current = true
      const refreshStartedAt = Date.now()
      const refreshToken = ++refreshTokenRef.current

      if (!snapshot.initialized) {
        setSnapshot(entry => ({
          ...entry,
          isLoading: true,
          error: null,
        }))
      }

      try {
        const result = await refreshBusinessInventoryRealtimeSnapshot(accountId)
        if (refreshToken !== refreshTokenRef.current) return

        inventoryRelatedTransactionsRef.current = result.inventoryRelatedTransactions
        const telemetryTimestamp = Date.now()

        setSnapshot(entry => {
          const itemsNext =
            itemsRealtimeAtRef.current > refreshStartedAt ? entry.items : result.items
          const transactionsNext =
            transactionsRealtimeAtRef.current > refreshStartedAt ? entry.transactions : result.transactions
          return {
            ...entry,
            items: itemsNext,
            transactions: transactionsNext,
            isLoading: false,
            initialized: true,
            error: null,
            telemetry: {
              ...entry.telemetry,
              lastItemsRefreshAt: telemetryTimestamp,
              lastTransactionsRefreshAt: telemetryTimestamp,
              lastCollectionsRefreshAt: telemetryTimestamp,
            },
          }
        })

        ensureSubscriptions(accountId, result.items, result.businessInventoryTransactions)
      } catch (error) {
        console.error('BusinessInventoryRealtimeProvider: failed to refresh collections', error)
        setSnapshot(entry => ({
          ...entry,
          isLoading: false,
          initialized: true,
          error: 'Failed to load business inventory',
        }))
      } finally {
        refreshInFlightRef.current = false
        lastRefreshAtRef.current = Date.now()
      }
    },
    [currentAccountId, ensureSubscriptions, refreshCooldownMs, snapshot.initialized]
  )

  useEffect(() => {
    if (!currentAccountId) {
      cleanupSubscriptions()
      resetSnapshot()
      previousAccountIdRef.current = null
      return
    }

    if (previousAccountIdRef.current && previousAccountIdRef.current !== currentAccountId) {
      cleanupSubscriptions()
      resetSnapshot()
    }

    previousAccountIdRef.current = currentAccountId

    if (!snapshot.initialized && !initializingRef.current) {
      initializingRef.current = true
      void refreshCollections({ force: true, accountId: currentAccountId }).finally(() => {
        initializingRef.current = false
      })
    }
  }, [cleanupSubscriptions, currentAccountId, refreshCollections, resetSnapshot, snapshot.initialized])

  useEffect(() => {
    const unsubscribe = subscribeToNetworkStatus(networkStatus => {
      const wasOnline = previousOnlineStatusRef.current
      previousOnlineStatusRef.current = networkStatus.isOnline

      if (!networkStatus.isOnline || wasOnline) {
        return
      }
      if (!currentAccountId) return
      void refreshCollections({ force: true })
    })

    return unsubscribe
  }, [currentAccountId, refreshCollections])

  useEffect(() => {
    const unsubscribe = onSyncEvent('complete', payload => {
      if (payload?.pendingOperations && payload.pendingOperations > 0) {
        return
      }
      if (!currentAccountId) return
      void refreshCollections({ force: true })
    })
    return unsubscribe
  }, [currentAccountId, refreshCollections])

  useEffect(() => {
    registerBusinessInventoryRefreshCallback(accountId => {
      void refreshCollections({ accountId, force: true })
    })
    return () => {
      registerBusinessInventoryRefreshCallback(() => {})
    }
  }, [refreshCollections])

  const contextValue = useMemo<BusinessInventoryRealtimeContextValue>(
    () => ({
      snapshot,
      refreshCollections,
    }),
    [refreshCollections, snapshot]
  )

  return (
    <BusinessInventoryRealtimeContext.Provider value={contextValue}>
      {children}
    </BusinessInventoryRealtimeContext.Provider>
  )
}

export function useBusinessInventoryRealtime() {
  const context = useContext(BusinessInventoryRealtimeContext)
  if (!context) {
    throw new Error('useBusinessInventoryRealtime must be used within a BusinessInventoryRealtimeProvider')
  }

  const { snapshot, refreshCollections } = context

  return {
    items: snapshot.items,
    transactions: snapshot.transactions,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    telemetry: snapshot.telemetry,
    refreshCollections,
  }
}
