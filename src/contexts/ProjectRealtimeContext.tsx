import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccount } from './AccountContext'
import type { Item, Project, Transaction } from '@/types'
import { lineageService } from '@/services/lineageService'
import { projectService, transactionService, unifiedItemsService } from '@/services/inventoryService'
import { isNetworkOnline, subscribeToNetworkStatus, getNetworkStatusSnapshot } from '@/services/networkStatusService'
import { offlineStore } from '@/services/offlineStore'
import { registerSnapshotRefreshCallback } from '@/utils/realtimeSnapshotUpdater'

type ProjectRealtimeTelemetry = {
  activeChannelCount: number
  lineageSubscriptionCount: number
  lastProjectRefreshAt: number | null
  lastTransactionsRefreshAt: number | null
  lastItemsRefreshAt: number | null
  lastCollectionsRefreshAt: number | null
  lastDisconnectAt: number | null
  lastDisconnectReason: string | null
  lastCacheHydrationAt: number | null
}

type ProjectRealtimeEntry = {
  project: Project | null
  transactions: Transaction[]
  items: Item[]
  isLoading: boolean
  error: string | null
  initialized: boolean
  refCount: number
  telemetry: ProjectRealtimeTelemetry
  hydratedFromCache: boolean
}

type ProjectSubscriptions = {
  transactionUnsubscribe?: () => void
  itemsUnsubscribe?: () => void
  lineageUnsubscribes: Array<() => void>
}

interface ProjectRealtimeContextValue {
  snapshots: Record<string, ProjectRealtimeEntry>
  registerProject: (projectId: string) => void
  releaseProject: (projectId: string) => void
  refreshProject: (projectId: string) => Promise<void>
  refreshTransactions: (projectId: string) => Promise<void>
  refreshItems: (projectId: string) => Promise<void>
  refreshCollections: (projectId: string, options?: { includeProject?: boolean }) => Promise<void>
  refreshFromIndexedDB: (projectId: string) => Promise<void>
}

const ProjectRealtimeContext = createContext<ProjectRealtimeContextValue | undefined>(undefined)

const createDefaultTelemetry = (): ProjectRealtimeTelemetry => ({
  activeChannelCount: 0,
  lineageSubscriptionCount: 0,
  lastProjectRefreshAt: null,
  lastTransactionsRefreshAt: null,
  lastItemsRefreshAt: null,
  lastCollectionsRefreshAt: null,
  lastDisconnectAt: null,
  lastDisconnectReason: null,
  lastCacheHydrationAt: null,
})

const createEmptyEntry = (): ProjectRealtimeEntry => ({
  project: null,
  transactions: [],
  items: [],
  isLoading: true,
  error: null,
  initialized: false,
  refCount: 0,
  telemetry: createDefaultTelemetry(),
  hydratedFromCache: false,
})

interface ProviderProps {
  children: ReactNode
  cleanupDelayMs?: number
}

export function ProjectRealtimeProvider({ children, cleanupDelayMs = 15000 }: ProviderProps) {
  const { currentAccountId } = useAccount()
  const [snapshots, setSnapshots] = useState<Record<string, ProjectRealtimeEntry>>({})
  const subscriptionsRef = useRef<Record<string, ProjectSubscriptions>>({})
  const cleanupTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const initializingRef = useRef<Record<string, boolean>>({})
  const cacheRefreshRef = useRef<Record<string, boolean>>({})

  const setEntry = useCallback(
    (projectId: string, updater: (entry: ProjectRealtimeEntry) => ProjectRealtimeEntry) => {
      setSnapshots(prev => {
        const existing = prev[projectId] ?? createEmptyEntry()
        return {
          ...prev,
          [projectId]: updater(existing),
        }
      })
    },
    []
  )

  const updateExistingEntry = useCallback(
    (projectId: string, updater: (entry: ProjectRealtimeEntry) => ProjectRealtimeEntry) => {
      setSnapshots(prev => {
        const existing = prev[projectId]
        if (!existing) return prev
        return {
          ...prev,
          [projectId]: updater(existing),
        }
      })
    },
    []
  )

  const applyTelemetryPatch = useCallback(
    (projectId: string, patch: Partial<ProjectRealtimeTelemetry>) => {
      setEntry(projectId, entry => ({
        ...entry,
        telemetry: {
          ...entry.telemetry,
          ...patch,
        },
      }))
    },
    [setEntry]
  )

  const updateChannelTelemetry = useCallback(
    (projectId: string) => {
      const subs = subscriptionsRef.current[projectId]
      const activeChannelCount = (subs?.transactionUnsubscribe ? 1 : 0) + (subs?.itemsUnsubscribe ? 1 : 0)
      const lineageSubscriptionCount = subs?.lineageUnsubscribes?.length ?? 0
      applyTelemetryPatch(projectId, { activeChannelCount, lineageSubscriptionCount })
    },
    [applyTelemetryPatch]
  )

  const handleChannelStatus = useCallback(
    (projectId: string, source: 'transactions' | 'items', status: string, err?: unknown) => {
      if (!projectId) return
      if (status === 'SUBSCRIBED') {
        applyTelemetryPatch(projectId, { lastDisconnectAt: null, lastDisconnectReason: null })
        return
      }
      if (!['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) return

      updateExistingEntry(projectId, entry => {
        if (status === 'CLOSED' && entry.refCount === 0) {
          return entry
        }
        const now = Date.now()
        const message =
          typeof err === 'object' && err && 'message' in err && typeof (err as any).message === 'string'
            ? (err as any).message
            : ''
        const statusLabel = status.toLowerCase().replace(/_/g, ' ')
        const reason = `${source} channel ${statusLabel}${message ? ` — ${message}` : ''}`
        return {
          ...entry,
          telemetry: {
            ...entry.telemetry,
            lastDisconnectAt: now,
            lastDisconnectReason: reason,
          },
        }
      })
    },
    [applyTelemetryPatch, updateExistingEntry]
  )

  const cleanupSubscriptions = useCallback(
    (projectId: string) => {
      const subs = subscriptionsRef.current[projectId]
      if (!subs) return

      try {
        subs.transactionUnsubscribe?.()
      } catch (error) {
        console.debug('ProjectRealtimeProvider: failed to unsubscribe transactions channel', error)
      }

      try {
        subs.itemsUnsubscribe?.()
      } catch (error) {
        console.debug('ProjectRealtimeProvider: failed to unsubscribe items channel', error)
      }

      subs.lineageUnsubscribes?.forEach(unsub => {
        try {
          unsub()
        } catch (error) {
          console.debug('ProjectRealtimeProvider: failed to unsubscribe lineage channel', error)
        }
      })

      delete subscriptionsRef.current[projectId]
      applyTelemetryPatch(projectId, {
        activeChannelCount: 0,
        lineageSubscriptionCount: 0,
      })
    },
    [applyTelemetryPatch]
  )

  const clearCleanupTimer = useCallback((projectId: string) => {
    const timer = cleanupTimersRef.current[projectId]
    if (timer) {
      clearTimeout(timer)
      delete cleanupTimersRef.current[projectId]
    }
  }, [])

  const cleanupProject = useCallback(
    (projectId: string) => {
      cleanupSubscriptions(projectId)
      setSnapshots(prev => {
        if (!prev[projectId]) return prev
        const next = { ...prev }
        delete next[projectId]
        return next
      })
      delete initializingRef.current[projectId]
    },
    [cleanupSubscriptions]
  )

  const scheduleCleanup = useCallback(
    (projectId: string) => {
      clearCleanupTimer(projectId)
      cleanupTimersRef.current[projectId] = setTimeout(() => {
        cleanupProject(projectId)
      }, cleanupDelayMs)
    },
    [cleanupDelayMs, cleanupProject, clearCleanupTimer]
  )

  const registerProject = useCallback(
    (projectId: string) => {
      if (!projectId) return
      clearCleanupTimer(projectId)
      setEntry(projectId, entry => ({
        ...entry,
        refCount: entry.refCount + 1,
        isLoading: entry.initialized ? entry.isLoading : true,
      }))
    },
    [clearCleanupTimer, setEntry]
  )

  const releaseProject = useCallback(
    (projectId: string) => {
      if (!projectId) return
      let shouldScheduleCleanup = false

      setSnapshots(prev => {
        const existing = prev[projectId]
        if (!existing) return prev
        const nextCount = Math.max(0, existing.refCount - 1)
        shouldScheduleCleanup = nextCount === 0
        return {
          ...prev,
          [projectId]: {
            ...existing,
            refCount: nextCount,
          },
        }
      })

      if (shouldScheduleCleanup) {
        scheduleCleanup(projectId)
      }
    },
    [scheduleCleanup]
  )

  const refreshProject = useCallback(
    async (projectId: string) => {
      if (!currentAccountId) return
      try {
        const project = await projectService.getProject(currentAccountId, projectId)
        if (!project) {
          setEntry(projectId, entry => ({
            ...entry,
            project: null,
            error: 'Project not found',
            initialized: true,
            isLoading: false,
          }))
          return
        }

        setEntry(projectId, entry => ({
          ...entry,
          project,
          error: null,
          initialized: true,
          isLoading: false,
        }))
      } catch (error) {
        console.error('ProjectRealtimeProvider: failed to refresh project', error)
        setEntry(projectId, entry => ({
          ...entry,
          error: 'Failed to load project',
          isLoading: false,
        }))
        throw error
      }
      applyTelemetryPatch(projectId, { lastProjectRefreshAt: Date.now() })
    },
    [applyTelemetryPatch, currentAccountId, setEntry]
  )

  const fetchAndStoreItems = useCallback(
    async (projectId: string): Promise<Item[]> => {
      if (!currentAccountId) return []
      const itemsData = await unifiedItemsService.getItemsByProject(currentAccountId, projectId)
      setEntry(projectId, entry => ({
        ...entry,
        items: itemsData,
      }))
      unifiedItemsService.syncProjectItemsRealtimeCache(currentAccountId, projectId, itemsData)
      const now = Date.now()
      applyTelemetryPatch(projectId, {
        lastItemsRefreshAt: now,
        lastCollectionsRefreshAt: now,
      })
      return itemsData
    },
    [applyTelemetryPatch, currentAccountId, setEntry]
  )

  const fetchAndStoreTransactions = useCallback(
    async (projectId: string): Promise<Transaction[]> => {
      if (!currentAccountId) return []
      const transactionsData = await transactionService.getTransactions(currentAccountId, projectId)
      setEntry(projectId, entry => ({
        ...entry,
        transactions: transactionsData,
      }))
      const now = Date.now()
      applyTelemetryPatch(projectId, {
        lastTransactionsRefreshAt: now,
        lastCollectionsRefreshAt: now,
      })
      return transactionsData
    },
    [applyTelemetryPatch, currentAccountId, setEntry]
  )

  const attachLineageSubscriptions = useCallback(
    (projectId: string, transactions: Transaction[]) => {
      if (!currentAccountId) return

      const existing = subscriptionsRef.current[projectId]
      existing?.lineageUnsubscribes?.forEach(unsub => {
        try {
          unsub()
        } catch {
          /* noop */
        }
      })

      const lineageUnsubscribes =
        transactions
          .map(tx => tx.transactionId)
          .filter((txId): txId is string => !!txId)
          .map(txId =>
            lineageService.subscribeToEdgesFromTransaction(currentAccountId, txId, () => {
              void Promise.all([fetchAndStoreTransactions(projectId), fetchAndStoreItems(projectId)]).catch(err =>
                console.debug('ProjectRealtimeProvider: lineage refresh failed', err)
              )
            })
          ) ?? []

      subscriptionsRef.current[projectId] = {
        transactionUnsubscribe: existing?.transactionUnsubscribe,
        itemsUnsubscribe: existing?.itemsUnsubscribe,
        lineageUnsubscribes,
      }
      updateChannelTelemetry(projectId)
    },
    [currentAccountId, fetchAndStoreItems, fetchAndStoreTransactions, updateChannelTelemetry]
  )

  const startRealtimeSubscriptions = useCallback(
    (projectId: string, transactionsSeed: Transaction[], itemsSeed: Item[]) => {
      if (!currentAccountId) return

      cleanupSubscriptions(projectId)

      const transactionUnsubscribe = transactionService.subscribeToTransactions(
        currentAccountId,
        projectId,
        updatedTransactions => {
          setEntry(projectId, entry => ({
            ...entry,
            transactions: updatedTransactions,
          }))
          const now = Date.now()
          applyTelemetryPatch(projectId, {
            lastTransactionsRefreshAt: now,
            lastCollectionsRefreshAt: now,
          })
          attachLineageSubscriptions(projectId, updatedTransactions)
        },
        transactionsSeed,
        {
          onStatusChange: (status, err) => handleChannelStatus(projectId, 'transactions', status, err),
        }
      )

      const itemsUnsubscribe = unifiedItemsService.subscribeToProjectItems(
        currentAccountId,
        projectId,
        updatedItems => {
          setEntry(projectId, entry => ({
            ...entry,
            items: updatedItems,
          }))
          const now = Date.now()
          applyTelemetryPatch(projectId, {
            lastItemsRefreshAt: now,
            lastCollectionsRefreshAt: now,
          })
        },
        itemsSeed,
        {
          onStatusChange: (status, err) => handleChannelStatus(projectId, 'items', status, err),
        }
      )

      subscriptionsRef.current[projectId] = {
        transactionUnsubscribe,
        itemsUnsubscribe,
        lineageUnsubscribes: [],
      }

      attachLineageSubscriptions(projectId, transactionsSeed)
    },
    [attachLineageSubscriptions, cleanupSubscriptions, currentAccountId, handleChannelStatus, setEntry]
  )

  const refreshItems = useCallback(
    async (projectId: string) => {
      await fetchAndStoreItems(projectId)
    },
    [fetchAndStoreItems]
  )

  const refreshTransactions = useCallback(
    async (projectId: string) => {
      const transactionsData = await fetchAndStoreTransactions(projectId)
      attachLineageSubscriptions(projectId, transactionsData)
    },
    [attachLineageSubscriptions, fetchAndStoreTransactions]
  )

  const refreshCollections = useCallback(
    async (projectId: string, options?: { includeProject?: boolean }) => {
      const transactionsPromise = fetchAndStoreTransactions(projectId)
      const itemsPromise = fetchAndStoreItems(projectId)
      const waiters: Promise<unknown>[] = [transactionsPromise, itemsPromise]
      if (options?.includeProject) {
        waiters.push(refreshProject(projectId))
      }
      await Promise.all(waiters)
      const transactionsData = await transactionsPromise
      attachLineageSubscriptions(projectId, transactionsData)
      applyTelemetryPatch(projectId, { lastCollectionsRefreshAt: Date.now() })
    },
    [applyTelemetryPatch, attachLineageSubscriptions, fetchAndStoreItems, fetchAndStoreTransactions, refreshProject]
  )

  const hydrateProjectFromIndexedDB = useCallback(
    async (projectId: string) => {
      if (!currentAccountId) return

      try {
        await offlineStore.init()

        // Load project
        const cachedProject = await offlineStore.getProjectById(projectId)
        const project: Project | null = cachedProject
          ? {
              id: cachedProject.id,
              accountId: cachedProject.accountId,
              name: cachedProject.name,
              description: cachedProject.description || '',
              clientName: cachedProject.clientName || '',
              budget: cachedProject.budget,
              designFee: cachedProject.designFee,
              budgetCategories: cachedProject.budgetCategories,
              defaultCategoryId: cachedProject.defaultCategoryId || undefined,
              mainImageUrl: cachedProject.mainImageUrl,
              createdAt: new Date(cachedProject.createdAt),
              updatedAt: new Date(cachedProject.updatedAt),
              createdBy: cachedProject.createdBy || '',
              settings: cachedProject.settings || undefined,
              metadata: cachedProject.metadata || undefined,
              itemCount: cachedProject.itemCount || 0,
              transactionCount: cachedProject.transactionCount || 0,
              totalValue: cachedProject.totalValue || 0,
            }
          : null

        // Load items
        const cachedItems = await offlineStore.getItems(projectId)
        const items = cachedItems
          .filter(item => !item.accountId || item.accountId === currentAccountId)
          .map(item => unifiedItemsService._convertOfflineItem(item))

        // Load transactions
        const cachedTransactions = await offlineStore.getTransactions(projectId)
        const transactions: Transaction[] = []
        for (const tx of cachedTransactions.filter(tx => tx.accountId === currentAccountId)) {
          try {
            const { transaction } = await transactionService._getTransactionByIdOffline(
              currentAccountId,
              tx.transactionId
            )
            if (transaction) {
              transactions.push(transaction)
            }
          } catch (error) {
            console.warn(`Failed to convert cached transaction ${tx.transactionId}:`, error)
          }
        }

        // Update snapshot
        setEntry(projectId, entry => ({
          ...entry,
          project,
          items,
          transactions,
          initialized: true,
          isLoading: false,
          error: project ? null : 'Project not found in cache',
          hydratedFromCache: true,
        }))

        const now = Date.now()
        applyTelemetryPatch(projectId, {
          lastCollectionsRefreshAt: now,
          lastCacheHydrationAt: now,
        })
      } catch (error) {
        console.error('Failed to hydrate project from IndexedDB:', error)
        setEntry(projectId, entry => ({
          ...entry,
          error: 'Failed to load from cache',
          isLoading: false,
        }))
      }
    },
    [currentAccountId, setEntry, applyTelemetryPatch]
  )

  const refreshFromIndexedDB = useCallback(
    async (projectId: string) => {
      await hydrateProjectFromIndexedDB(projectId)
    },
    [hydrateProjectFromIndexedDB]
  )

  const initializeProject = useCallback(
    async (projectId: string) => {
      if (initializingRef.current[projectId]) return
      initializingRef.current[projectId] = true

      if (!currentAccountId) {
        initializingRef.current[projectId] = false
        return
      }

      // Guard: don't initialize projects while offline, but hydrate from IndexedDB
      if (!isNetworkOnline()) {
        console.warn(`ProjectRealtimeProvider: Skipping network initialization of project ${projectId} while offline, hydrating from cache`)
        await hydrateProjectFromIndexedDB(projectId)
        initializingRef.current[projectId] = false
        return
      }

      setEntry(projectId, entry => ({
        ...entry,
        isLoading: true,
        error: null,
      }))

      try {
        const [project, transactionsData, itemsData] = await Promise.all([
          projectService.getProject(currentAccountId, projectId),
          transactionService.getTransactions(currentAccountId, projectId),
          unifiedItemsService.getItemsByProject(currentAccountId, projectId),
        ])

        if (!project) {
          setEntry(projectId, entry => ({
            ...entry,
            project: null,
            transactions: [],
            items: [],
            error: 'Project not found',
            isLoading: false,
            initialized: true,
          }))
          return
        }

        setEntry(projectId, entry => ({
          ...entry,
          project,
          transactions: transactionsData,
          items: itemsData,
          error: null,
          isLoading: false,
          initialized: true,
          hydratedFromCache: false,
        }))
        const now = Date.now()
        applyTelemetryPatch(projectId, {
          lastProjectRefreshAt: now,
          lastTransactionsRefreshAt: now,
          lastItemsRefreshAt: now,
          lastCollectionsRefreshAt: now,
        })

        startRealtimeSubscriptions(projectId, transactionsData, itemsData)
      } catch (error) {
        console.error('ProjectRealtimeProvider: failed to initialize project', error)
        setEntry(projectId, entry => ({
          ...entry,
          error: 'Failed to load project',
          isLoading: false,
        }))
      } finally {
        initializingRef.current[projectId] = false
      }
    },
    [applyTelemetryPatch, currentAccountId, hydrateProjectFromIndexedDB, setEntry, startRealtimeSubscriptions]
  )

  useEffect(() => {
    // Don't attempt initialization while offline to prevent infinite loops
    if (!isNetworkOnline()) {
      return
    }
    
    Object.entries(snapshots).forEach(([projectId, entry]) => {
      if (entry.refCount > 0 && !entry.initialized && !initializingRef.current[projectId]) {
        void initializeProject(projectId)
      }
    })
  }, [initializeProject, snapshots])

  // Handle network status transitions: refresh cache-hydrated projects when network comes back online
  useEffect(() => {
    const unsubscribe = subscribeToNetworkStatus(networkStatus => {
      // When network comes back online, refresh projects that were hydrated from cache
      // Use refreshCollections instead of initializeProject to avoid toggling isLoading
      if (networkStatus.isOnline) {
        Object.entries(snapshots).forEach(([projectId, entry]) => {
          if (
            entry.refCount > 0 &&
            entry.initialized &&
            entry.hydratedFromCache &&
            !initializingRef.current[projectId] &&
            !cacheRefreshRef.current[projectId]
          ) {
            // Refresh collections without toggling isLoading, so cached UI stays visible
            cacheRefreshRef.current[projectId] = true
            void refreshCollections(projectId, { includeProject: true })
              .then(() => {
                setEntry(projectId, projEntry => ({
                  ...projEntry,
                  hydratedFromCache: false,
                }))
              })
              .catch(error => {
                console.error('ProjectRealtimeProvider: cache refresh after reconnect failed', error)
              })
              .finally(() => {
                cacheRefreshRef.current[projectId] = false
              })
          }
        })
      }
    })

    return unsubscribe
  }, [refreshCollections, snapshots, setEntry])

  const contextValue = useMemo<ProjectRealtimeContextValue>(
    () => ({
      snapshots,
      registerProject,
      releaseProject,
      refreshProject,
      refreshTransactions,
      refreshItems,
      refreshCollections,
      refreshFromIndexedDB,
    }),
    [snapshots, registerProject, releaseProject, refreshProject, refreshTransactions, refreshItems, refreshCollections, refreshFromIndexedDB]
  )

  // Register snapshot refresh callback for offline services
  useEffect(() => {
    registerSnapshotRefreshCallback(refreshFromIndexedDB)
    // Cleanup: unregister callback when component unmounts
    return () => {
      registerSnapshotRefreshCallback(() => {})
    }
  }, [refreshFromIndexedDB])

  return <ProjectRealtimeContext.Provider value={contextValue}>{children}</ProjectRealtimeContext.Provider>
}

export function useProjectRealtime(projectId?: string | null) {
  const context = useContext(ProjectRealtimeContext)
  if (!context) {
    throw new Error('useProjectRealtime must be used within a ProjectRealtimeProvider')
  }

  const {
    snapshots,
    registerProject,
    releaseProject,
    refreshProject,
    refreshTransactions,
    refreshItems,
    refreshCollections,
  } = context

  useEffect(() => {
    if (!projectId) return
    registerProject(projectId)
    return () => {
      releaseProject(projectId)
    }
  }, [projectId, registerProject, releaseProject])

  const snapshot = projectId ? snapshots[projectId] : undefined
  const noop = async () => {}

  return {
    project: snapshot?.project ?? null,
    transactions: snapshot?.transactions ?? [],
    items: snapshot?.items ?? [],
    isLoading: snapshot ? snapshot.isLoading : Boolean(projectId),
    error: snapshot?.error ?? null,
    telemetry: snapshot?.telemetry ?? createDefaultTelemetry(),
    refreshProject: projectId ? () => refreshProject(projectId) : noop,
    refreshTransactions: projectId ? () => refreshTransactions(projectId) : noop,
    refreshItems: projectId ? () => refreshItems(projectId) : noop,
    refreshCollections: projectId ? (options?: { includeProject?: boolean }) => refreshCollections(projectId, options) : noop,
  }
}

export function useProjectRealtimeOverview() {
  const context = useContext(ProjectRealtimeContext)
  if (!context) {
    throw new Error('useProjectRealtimeOverview must be used within a ProjectRealtimeProvider')
  }

  return {
    snapshots: context.snapshots,
    refreshCollections: context.refreshCollections,
  }
}

