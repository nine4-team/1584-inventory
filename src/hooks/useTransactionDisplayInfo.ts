import { useQueryClient, QueryClient } from '@tanstack/react-query'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { getGlobalQueryClient } from '@/utils/queryClient'
import { useOfflineAwareQuery } from './useOfflineAwareQuery'
import { offlineStore } from '@/services/offlineStore'
import { projectTransactionDetail } from '@/utils/routes'

// Utility function to invalidate transaction display info cache (can be called from services)
export function invalidateTransactionDisplayInfo(accountId: string, transactionId: string) {
  const queryClient = getGlobalQueryClient()
  queryClient.invalidateQueries({ queryKey: ['transaction-display-info', accountId, transactionId] })
}

export function invalidateAllTransactionDisplayInfo() {
  const queryClient = getGlobalQueryClient()
  queryClient.invalidateQueries({ queryKey: ['transaction-display-info'] })
}

export function useTransactionDisplayInfo(
  accountId: string | null,
  transactionId: string | null | undefined,
  projectId?: string | null
) {
  const queryClient = useQueryClient()

  const queryKey = ['transaction-display-info', accountId, transactionId]

  const query = useOfflineAwareQuery({
    queryKey,
    queryFn: async () => {
      if (!accountId || !transactionId) {
        return { displayInfo: null, route: null }
      }

      const [displayInfo, route] = await Promise.all([
        getTransactionDisplayInfo(accountId, transactionId, 20),
        getTransactionRoute(transactionId, accountId, projectId)
      ])

      return { displayInfo, route }
    },
    offlineFallback: async () => {
      if (!accountId || !transactionId) {
        return { displayInfo: null, route: null }
      }

      try {
        await offlineStore.init()
        const cached = await offlineStore.getTransactionById(transactionId)
        if (!cached) {
          return null
        }

        const displayInfo = buildDisplayInfoFromOffline(cached.source, transactionId, cached.amount)
        const resolvedProjectId = projectId ?? cached.projectId ?? null
        const route = resolvedProjectId
          ? {
              path: projectTransactionDetail(resolvedProjectId, transactionId),
              projectId: resolvedProjectId
            }
          : { path: '/projects', projectId: null }

        return { displayInfo, route }
      } catch (error) {
        console.warn('Failed to get offline transaction display info:', error)
        return null
      }
    },
    enabled: !!(accountId && transactionId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  // Method to invalidate this specific transaction's display info
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey })
  }

  // Method to invalidate all transaction display info
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['transaction-display-info'] })
  }

  return {
    ...query,
    displayInfo: query.data?.displayInfo || null,
    route: query.data?.route || null,
    invalidate,
    invalidateAll,
  }
}

function buildDisplayInfoFromOffline(source: string, transactionId: string | null | undefined, amount: string | undefined | null) {
  const title = formatTransactionTitle(transactionId, source, 20)
  const formattedAmount = `$${parseFloat(amount || '0').toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`

  return { title, amount: formattedAmount }
}

function formatTransactionTitle(transactionId: string | null | undefined, source: string, maxLength: number) {
  if (transactionId?.startsWith('INV_SALE_')) {
    return 'Design Business Inventory Sale'
  }
  if (transactionId?.startsWith('INV_PURCHASE_')) {
    return 'Design Business Inventory Purchase'
  }

  let title = source || 'Transaction'
  if (title.length > maxLength) {
    title = `${title.substring(0, maxLength - 3)}...`
  }
  return title
}