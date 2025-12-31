import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query'
import { getTransactionDisplayInfo, getTransactionRoute } from '@/utils/transactionDisplayUtils'
import { getGlobalQueryClient } from '@/utils/queryClient'

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

  const query = useQuery({
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