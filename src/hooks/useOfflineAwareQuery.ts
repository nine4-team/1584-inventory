import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient, UseQueryOptions, QueryKey } from '@tanstack/react-query'
import { useNetworkState } from './useNetworkState'
import { offlineStore } from '../services/offlineStore'

interface OfflineAwareQueryOptions<TData, TError = unknown>
  extends Omit<UseQueryOptions<TData, TError>, 'queryFn' | 'queryKey'> {
  queryKey: QueryKey
  queryFn: () => Promise<TData>
  offlineFallback?: () => Promise<TData | null>
  onSuccess?: (data: TData) => Promise<void> | void
}

export function useOfflineAwareQuery<TData = unknown, TError = unknown>({
  queryKey,
  queryFn,
  offlineFallback,
  onSuccess,
  ...options
}: OfflineAwareQueryOptions<TData, TError>) {
  const { isOnline } = useNetworkState()
  const queryClient = useQueryClient()
  const hydratedKeyRef = useRef<string | null>(null)
  const serializedKey = JSON.stringify(queryKey)

  useEffect(() => {
    hydratedKeyRef.current = null
  }, [serializedKey])

  useEffect(() => {
    if (!offlineFallback) return
    if (hydratedKeyRef.current === serializedKey && queryClient.getQueryData<TData>(queryKey)) {
      return
    }

    let cancelled = false
    hydratedKeyRef.current = serializedKey

    const hydrate = async () => {
      try {
        const offlineData = await offlineFallback()
        if (cancelled) return
        if (offlineData !== null && offlineData !== undefined) {
          queryClient.setQueryData(queryKey, offlineData)
        }
      } catch (error) {
        console.warn('Failed to hydrate query from offline cache:', error)
      }
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [offlineFallback, queryClient, queryKey, serializedKey])

  return useQuery({
    queryKey,
    queryFn: async () => {
      try {
        // Try network request first if online
        if (isOnline) {
          const data = await queryFn()

          // Cache successful network response in IndexedDB
          if (onSuccess) {
            await onSuccess(data)
          }

          return data
        }
      } catch (error) {
        console.warn('Network request failed, falling back to offline data:', error)
      }

      // Fall back to offline data
      if (offlineFallback) {
        try {
          await offlineStore.init()
        } catch (error) {
          console.warn('Failed to initialize offline store before fallback:', error)
        }
        const offlineData = await offlineFallback()
        if (offlineData !== null) {
          return offlineData
        }
      }

      // If no offline fallback or it returned null, throw error
      throw new Error('No data available offline')
    },
    ...options,
    // Don't refetch automatically when offline
    refetchOnWindowFocus: isOnline ? options.refetchOnWindowFocus : false,
    refetchOnReconnect: true,
  })
}

// Helper hook for simple offline-aware queries with automatic caching
export function useCachedQuery<TData = unknown, TError = unknown>(
  queryKey: QueryKey,
  fetchFn: () => Promise<TData>,
  cacheKey: string,
  options?: Partial<UseQueryOptions<TData, TError>>
) {
  const { isOnline } = useNetworkState()

  return useOfflineAwareQuery({
    queryKey,
    queryFn: fetchFn,
    offlineFallback: async () => {
      try {
        await offlineStore.init()
        // Try to get from IndexedDB cache
        const cached = await offlineStore.getCachedData(cacheKey)
        return cached as TData | null
      } catch {
        return null
      }
    },
    onSuccess: async (data: TData) => {
      // Cache successful responses
      try {
        await offlineStore.init()
        await offlineStore.setCachedData(cacheKey, data)
      } catch (error) {
        console.warn('Failed to cache data:', error)
      }
    },
    staleTime: isOnline ? 5 * 60 * 1000 : Infinity, // 5 minutes when online, never stale when offline
    ...options
  })
}