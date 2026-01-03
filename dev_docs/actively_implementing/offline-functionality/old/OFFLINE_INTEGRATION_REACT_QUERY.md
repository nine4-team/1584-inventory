# Offline Functionality - React Query Integration

## Overview
Integrate offline functionality with React Query to provide seamless online/offline data management. This document covers how to modify existing queries and mutations to work with the offline layer.

## Prerequisites
- Phase 1 (Foundation) completed
- React Query already configured in the project
- Offline store and network state detection working

## Step 1: Create Offline-Aware Query Hook

### Create `/src/hooks/useOfflineQuery.ts`

```typescript
import { useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query'
import { useNetworkState } from './useNetworkState'
import { offlineStore } from '../services/offlineStore'
import { offlineItemService } from '../services/offlineItemService'

interface OfflineQueryOptions<T> extends Omit<UseQueryOptions<T>, 'queryFn'> {
  queryKey: any[]
  onlineQueryFn: () => Promise<T>
  offlineQueryFn?: () => Promise<T>
  cacheKey: string // Key for offline storage
}

export function useOfflineQuery<T>({
  queryKey,
  onlineQueryFn,
  offlineQueryFn,
  cacheKey,
  ...options
}: OfflineQueryOptions<T>) {
  const { isOnline } = useNetworkState()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey,
    queryFn: async () => {
      try {
        if (isOnline) {
          // Fetch from server and cache locally
          const data = await onlineQueryFn()

          // Cache the data for offline use
          // This depends on your data structure - adjust accordingly
          if (cacheKey === 'items' && Array.isArray(data)) {
            // Convert to DB format and cache
            const dbItems = data.map(item => ({
              ...item,
              version: 1,
              last_synced_at: new Date().toISOString()
            }))
            await offlineStore.saveItems(dbItems)
          }

          return data
        } else {
          // Serve from cache
          if (offlineQueryFn) {
            return await offlineQueryFn()
          }

          // Default offline behavior for items
          if (cacheKey === 'items') {
            const projectId = queryKey[1] // Assume ['items', projectId] format
            return await offlineItemService.getItems(projectId)
          }

          throw new Error('No offline data available')
        }
      } catch (error) {
        // Fallback to cache even if online request fails
        if (isOnline && offlineQueryFn) {
          try {
            return await offlineQueryFn()
          } catch (offlineError) {
            throw error // Throw original error
          }
        }
        throw error
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
    retry: (failureCount, error) => {
      // Don't retry on network errors when offline
      if (!isOnline && failureCount >= 1) return false
      return failureCount < 3
    },
    ...options
  })
}
```

## Step 2: Create Offline-Aware Mutation Hook

### Create `/src/hooks/useOfflineMutation.ts`

```typescript
import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query'
import { useNetworkState } from './useNetworkState'
import { operationQueue } from '../services/operationQueue'

interface OfflineMutationOptions<TData, TVariables> extends UseMutationOptions<TData, Error, TVariables> {
  operationType: string
  getOperationData: (variables: TVariables) => any
  optimisticUpdate?: (queryClient: any, variables: TVariables) => void
  rollbackUpdate?: (queryClient: any, variables: TVariables) => void
}

export function useOfflineMutation<TData, TVariables>({
  operationType,
  getOperationData,
  optimisticUpdate,
  rollbackUpdate,
  ...options
}: OfflineMutationOptions<TData, TVariables>) {
  const { isOnline } = useNetworkState()
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    mutationFn: async (variables: TVariables) => {
      // Add to operation queue
      const operation = {
        type: operationType,
        data: getOperationData(variables)
      }

      await operationQueue.add(operation)

      // Apply optimistic update immediately
      if (optimisticUpdate) {
        optimisticUpdate(queryClient, variables)
      }

      // If online, try to process immediately
      if (isOnline) {
        try {
          await operationQueue.processQueue()
          return { success: true } // Operation was processed
        } catch (error) {
          // Rollback optimistic update on failure
          if (rollbackUpdate) {
            rollbackUpdate(queryClient, variables)
          }
          throw error
        }
      }

      // Offline - operation is queued
      return { queued: true }
    },
    onError: (error, variables) => {
      // Rollback optimistic update
      if (rollbackUpdate) {
        rollbackUpdate(queryClient, variables)
      }

      // Call original onError if provided
      options.onError?.(error, variables, undefined)
    }
  })
}
```

## Step 3: Update Existing Item Queries

### Update `/src/hooks/useItems.ts` (assuming this exists)

```typescript
import { useOfflineQuery } from './useOfflineQuery'
import { useOfflineMutation } from './useOfflineMutation'
import { offlineItemService } from '../services/offlineItemService'

export function useItems(projectId: string) {
  return useOfflineQuery({
    queryKey: ['items', projectId],
    cacheKey: 'items',
    onlineQueryFn: () => offlineItemService.getItems(projectId),
    offlineQueryFn: () => offlineItemService.getItems(projectId)
  })
}

export function useCreateItem() {
  const queryClient = useQueryClient()

  return useOfflineMutation({
    operationType: 'CREATE_ITEM',
    getOperationData: (itemData: any) => itemData,
    optimisticUpdate: (queryClient, itemData) => {
      // Add temporary item to cache
      const tempId = `temp-${Date.now()}`
      const tempItem = {
        id: tempId,
        ...itemData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      queryClient.setQueryData(['items', itemData.project_id], (old: any) => {
        return old ? [...old, tempItem] : [tempItem]
      })
    },
    rollbackUpdate: (queryClient, itemData) => {
      // Remove temporary item from cache
      queryClient.setQueryData(['items', itemData.project_id], (old: any) => {
        return old ? old.filter((item: any) => item.id !== `temp-${Date.now()}`) : []
      })
    }
  })
}

export function useUpdateItem() {
  const queryClient = useQueryClient()

  return useOfflineMutation({
    operationType: 'UPDATE_ITEM',
    getOperationData: ({ id, updates }: { id: string, updates: any }) => ({ id, updates }),
    optimisticUpdate: (queryClient, { id, updates, projectId }) => {
      queryClient.setQueryData(['items', projectId], (old: any) => {
        return old ? old.map((item: any) =>
          item.id === id ? { ...item, ...updates, updated_at: new Date().toISOString() } : item
        ) : []
      })
    }
  })
}

export function useDeleteItem() {
  const queryClient = useQueryClient()

  return useOfflineMutation({
    operationType: 'DELETE_ITEM',
    getOperationData: ({ id }: { id: string }) => ({ id }),
    optimisticUpdate: (queryClient, { id, projectId }) => {
      queryClient.setQueryData(['items', projectId], (old: any) => {
        return old ? old.filter((item: any) => item.id !== id) : []
      })
    },
    rollbackUpdate: (queryClient, { id, projectId }) => {
      // Note: Deletion rollback is complex - would need to restore from server or cache
      // For now, we'll invalidate to refetch
      queryClient.invalidateQueries({ queryKey: ['items', projectId] })
    }
  })
}
```

## Step 4: Update Component Usage

### Update existing components to use offline-aware hooks

```typescript
// Before (direct service calls)
import { itemService } from '../services/itemService'

function ItemList({ projectId }: { projectId: string }) {
  const { data: items, isLoading } = useQuery({
    queryKey: ['items', projectId],
    queryFn: () => itemService.getItems(projectId)
  })

  // ... rest of component
}

// After (offline-aware)
import { useItems, useCreateItem, useUpdateItem, useDeleteItem } from '../hooks/useItems'

function ItemList({ projectId }: { projectId: string }) {
  const { data: items, isLoading } = useItems(projectId)
  const createItem = useCreateItem()
  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()

  // ... rest of component (no changes needed!)
}
```

## Step 5: React Query Configuration Updates

### Update `/src/lib/react-query.ts`

```typescript
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes
      retry: (failureCount, error) => {
        // Don't retry on network errors when offline
        if (!navigator.onLine && failureCount >= 1) return false
        return failureCount < 3
      },
      // Enable offline-first behavior
      networkMode: 'offlineFirst'
    },
    mutations: {
      // Mutations can run offline
      networkMode: 'offlineFirst'
    }
  },
})
```

## Step 6: Error Handling Integration

### Create `/src/hooks/useOfflineErrorHandler.ts`

```typescript
import { useCallback } from 'react'
import { useNetworkState } from './useNetworkState'

export function useOfflineErrorHandler() {
  const { isOnline } = useNetworkState()

  const handleError = useCallback((error: any) => {
    // Check if it's a network error
    if (!isOnline || error?.message?.includes('network') || error?.message?.includes('fetch')) {
      // Return user-friendly offline message
      return {
        title: 'Offline',
        message: 'This action has been saved and will sync when you reconnect.',
        type: 'offline'
      }
    }

    // Check for conflict errors
    if (error?.message?.includes('conflict')) {
      return {
        title: 'Data Conflict',
        message: 'This item was modified elsewhere. Please resolve the conflict.',
        type: 'conflict'
      }
    }

    // Default error handling
    return {
      title: 'Error',
      message: error?.message || 'An unexpected error occurred.',
      type: 'error'
    }
  }, [isOnline])

  return { handleError }
}
```

## Testing Criteria

### Unit Tests
- [ ] `useOfflineQuery` serves cached data when offline
- [ ] `useOfflineQuery` fetches from server and caches when online
- [ ] `useOfflineMutation` queues operations when offline
- [ ] `useOfflineMutation` applies optimistic updates
- [ ] Error handler returns appropriate messages for different error types

### Integration Tests
- [ ] Existing components work without modification
- [ ] Offline queries return cached data
- [ ] Mutations work both online and offline
- [ ] UI updates optimistically during offline operations
- [ ] Error messages are user-friendly

### Manual Testing
- [ ] Load items page online, verify server data loads
- [ ] Go offline, verify cached data displays
- [ ] Create item offline, verify optimistic update
- [ ] Reconnect, verify sync completes
- [ ] Check error handling for various scenarios

## Migration Strategy

### Gradual Adoption
1. **Start with read operations**: Update query hooks first
2. **Add write operations**: Update mutation hooks
3. **Test thoroughly**: Ensure no regressions
4. **Roll out gradually**: Enable for beta users first

### Backward Compatibility
- Keep existing service methods working
- Add feature flags to enable/disable offline mode
- Provide fallback to network-only mode

## Success Metrics
- All existing functionality works with offline layer
- No breaking changes to component interfaces
- Smooth transition between online/offline states
- Optimistic updates provide responsive UX
- Error handling is clear and actionable