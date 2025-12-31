# Offline Functionality - Phase 2: Operation Queuing Implementation

## Overview
Implement operation queuing system and background sync. This phase adds the ability to queue write operations when offline and sync them when connection is restored.

## Goals
- Queue CRUD operations when offline
- Sync queued operations when online
- Provide optimistic UI updates
- Handle sync failures gracefully

## Prerequisites
- Phase 1 (Foundation) must be complete and tested
- IndexedDB store working
- Network state detection working
- Read-only offline mode functional

## Implementation Scope
**DO NOT implement in this phase:**
- Conflict resolution (assume no conflicts for now)
- Advanced sync strategies
- Selective sync features

## Step 1: Operation Queue System

### Create `/src/types/operations.ts`

```typescript
export type OperationType =
  | 'CREATE_ITEM'
  | 'UPDATE_ITEM'
  | 'DELETE_ITEM'
  | 'CREATE_TRANSACTION'
  | 'UPDATE_TRANSACTION'
  | 'DELETE_TRANSACTION'

export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: string
  retryCount: number
  lastError?: string
}

export interface CreateItemOperation extends BaseOperation {
  type: 'CREATE_ITEM'
  data: {
    project_id: string
    name: string
    description?: string
    quantity: number
    unit_cost: number
  }
}

export interface UpdateItemOperation extends BaseOperation {
  type: 'UPDATE_ITEM'
  data: {
    id: string
    updates: Partial<{
      name: string
      description: string
      quantity: number
      unit_cost: number
    }>
  }
}

export interface DeleteItemOperation extends BaseOperation {
  type: 'DELETE_ITEM'
  data: {
    id: string
  }
}

export type Operation =
  | CreateItemOperation
  | UpdateItemOperation
  | DeleteItemOperation
```

### Create `/src/services/operationQueue.ts`

```typescript
import { Operation } from '../types/operations'
import { offlineStore } from './offlineStore'

class OperationQueue {
  private queue: Operation[] = []
  private isProcessing = false

  async init(): Promise<void> {
    // Load queued operations from IndexedDB
    try {
      const stored = localStorage.getItem('operation-queue')
      if (stored) {
        this.queue = JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load operation queue:', error)
      this.queue = []
    }
  }

  async add(operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount'>): Promise<void> {
    const fullOperation: Operation = {
      ...operation,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      retryCount: 0
    }

    this.queue.push(fullOperation)
    await this.persistQueue()

    // Try to process immediately if online
    if (navigator.onLine) {
      this.processQueue()
    }
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) {
      return
    }

    this.isProcessing = true

    try {
      const operation = this.queue[0] // Process FIFO

      const success = await this.executeOperation(operation)

      if (success) {
        this.queue.shift() // Remove completed operation
        await this.persistQueue()
        // Process next operation
        setTimeout(() => this.processQueue(), 100)
      } else {
        // Mark for retry with exponential backoff
        operation.retryCount++
        operation.lastError = 'Sync failed'

        if (operation.retryCount >= 5) {
          // Give up after 5 retries, mark as failed
          console.error('Operation failed permanently:', operation)
          this.queue.shift()
          await this.persistQueue()
        } else {
          // Schedule retry
          const delay = Math.min(1000 * Math.pow(2, operation.retryCount), 30000)
          setTimeout(() => this.processQueue(), delay)
        }

        await this.persistQueue()
      }
    } catch (error) {
      console.error('Error processing queue:', error)
      this.isProcessing = false
    } finally {
      this.isProcessing = false
    }
  }

  private async executeOperation(operation: Operation): Promise<boolean> {
    try {
      switch (operation.type) {
        case 'CREATE_ITEM':
          return await this.executeCreateItem(operation as CreateItemOperation)
        case 'UPDATE_ITEM':
          return await this.executeUpdateItem(operation as UpdateItemOperation)
        case 'DELETE_ITEM':
          return await this.executeDeleteItem(operation as DeleteItemOperation)
        default:
          console.error('Unknown operation type:', operation.type)
          return false
      }
    } catch (error) {
      console.error('Failed to execute operation:', error)
      return false
    }
  }

  private async executeCreateItem(operation: CreateItemOperation): Promise<boolean> {
    const { data } = operation

    // First update local store optimistically
    const tempId = `temp-${Date.now()}`
    const tempItem = {
      id: tempId,
      project_id: data.project_id,
      name: data.name,
      description: data.description,
      quantity: data.quantity,
      unit_cost: data.unit_cost,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1
    }

    await offlineStore.saveItems([tempItem])

    // Then sync with server
    try {
      const { data: serverItem, error } = await supabase
        .from('items')
        .insert({
          project_id: data.project_id,
          name: data.name,
          description: data.description,
          quantity: data.quantity,
          unit_cost: data.unit_cost
        })
        .select()
        .single()

      if (error) throw error

      // Update local store with real server data
      await offlineStore.saveItems([{
        ...serverItem,
        version: 1
      }])

      return true
    } catch (error) {
      // Rollback local changes on failure
      console.error('Failed to create item on server:', error)
      // Note: In a real implementation, you'd want to remove the temp item
      return false
    }
  }

  private async executeUpdateItem(operation: UpdateItemOperation): Promise<boolean> {
    const { data } = operation

    try {
      // Update server first
      const { error } = await supabase
        .from('items')
        .update(data.updates)
        .eq('id', data.id)

      if (error) throw error

      // Then update local store
      const existingItems = await offlineStore.getItems('') // Get all items
      const itemToUpdate = existingItems.find(item => item.id === data.id)

      if (itemToUpdate) {
        const updatedItem = {
          ...itemToUpdate,
          ...data.updates,
          updated_at: new Date().toISOString(),
          version: itemToUpdate.version + 1
        }
        await offlineStore.saveItems([updatedItem])
      }

      return true
    } catch (error) {
      console.error('Failed to update item:', error)
      return false
    }
  }

  private async executeDeleteItem(operation: DeleteItemOperation): Promise<boolean> {
    const { data } = operation

    try {
      // Delete from server
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', data.id)

      if (error) throw error

      // Note: Local store deletion will be handled by cache invalidation
      // in the React Query integration

      return true
    } catch (error) {
      console.error('Failed to delete item:', error)
      return false
    }
  }

  private async persistQueue(): Promise<void> {
    try {
      localStorage.setItem('operation-queue', JSON.stringify(this.queue))
    } catch (error) {
      console.error('Failed to persist operation queue:', error)
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getPendingOperations(): Operation[] {
    return [...this.queue]
  }

  clearQueue(): void {
    this.queue = []
    localStorage.removeItem('operation-queue')
  }
}

export const operationQueue = new OperationQueue()
```

## Step 2: Background Sync Service Worker

### Update `/public/sw-custom.js` (service worker bridge)

The production service worker now delegates **all** Background Sync events to whichever foreground tab is currently in focus. That tab already owns the IndexedDB-aware queue logic, so we avoid duplicating queue code inside the worker and get better insight/telemetry in the UI. The worker:

1. Listens for `'sync'` events tagged `sync-operations`.
2. Broadcasts a `PROCESS_OPERATION_QUEUE` message to every controlled client.
3. Waits for a matching `PROCESS_OPERATION_QUEUE_RESULT` response before resolving the sync event (with a timeout to reject hung tabs).

```javascript
// Excerpt from public/sw-custom.js
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-operations') {
    event.waitUntil(forwardQueueWorkToClients())
  }
})

async function forwardQueueWorkToClients() {
  const clients = await self.clients.matchAll({ includeUncontrolled: false })

  if (clients.length === 0) {
    // Nothing to do — foreground will retry when a tab opens.
    return
  }

  const resultPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('queue timeout')), 5000)

    const handleMessage = (event) => {
      if (event.data?.type === 'PROCESS_OPERATION_QUEUE_RESULT') {
        clearTimeout(timeout)
        self.removeEventListener('message', handleMessage)
        return event.data.success ? resolve(true) : reject(new Error(event.data.error || 'queue failed'))
      }
    }

    self.addEventListener('message', handleMessage)
  })

  clients.forEach((client) => {
    client.postMessage({ type: 'PROCESS_OPERATION_QUEUE' })
  })

  await resultPromise
}
```

Foreground tabs listen for `PROCESS_OPERATION_QUEUE` and call `operationQueue.processQueue()`, then reply with `PROCESS_OPERATION_QUEUE_RESULT`. This keeps all IndexedDB access within the window context (simpler permission story) while still satisfying the Background Sync contract.

## Step 3: Optimistic Updates Integration

### Update `/src/services/offlineItemService.ts`

```typescript
import { operationQueue } from './operationQueue'
import type { Operation } from '../types/operations'

export class OfflineItemService {
  // ... existing code ...

  async createItem(itemData: {
    project_id: string
    name: string
    description?: string
    quantity: number
    unit_cost: number
  }): Promise<void> {
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount'> = {
      type: 'CREATE_ITEM',
      data: itemData
    }

    await operationQueue.add(operation)

    // Trigger immediate processing if online
    if (navigator.onLine) {
      operationQueue.processQueue()
    }
  }

  async updateItem(itemId: string, updates: Partial<{
    name: string
    description: string
    quantity: number
    unit_cost: number
  }>): Promise<void> {
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount'> = {
      type: 'UPDATE_ITEM',
      data: { id: itemId, updates }
    }

    await operationQueue.add(operation)

    // Update local store optimistically
    const existingItems = await offlineStore.getItems('') // Get all for now
    const itemToUpdate = existingItems.find(item => item.id === itemId)

    if (itemToUpdate) {
      const optimisticItem = {
        ...itemToUpdate,
        ...updates,
        updated_at: new Date().toISOString(),
        version: itemToUpdate.version + 1
      }
      await offlineStore.saveItems([optimisticItem])
    }

    // Trigger immediate processing if online
    if (navigator.onLine) {
      operationQueue.processQueue()
    }
  }

  async deleteItem(itemId: string): Promise<void> {
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount'> = {
      type: 'DELETE_ITEM',
      data: { id: itemId }
    }

    await operationQueue.add(operation)

    // Optimistically remove from local store
    // Note: This is simplified - in practice you'd need to track deletions

    // Trigger immediate processing if online
    if (navigator.onLine) {
      operationQueue.processQueue()
    }
  }
}
```

## Step 4: Sync Status UI

### Create `/src/components/SyncStatus.tsx`

```typescript
import React, { useState, useEffect } from 'react'
import { operationQueue } from '../services/operationQueue'
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'

export function SyncStatus() {
  const [queueLength, setQueueLength] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)
  const { socketState, hasActiveChannels } = useRealtimeConnectionStatus()

  useEffect(() => {
    const updateStatus = () => {
      setQueueLength(operationQueue.getQueueLength())
    }

    updateStatus()
    const interval = setInterval(updateStatus, 2000)

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PROCESS_OPERATION_QUEUE') {
        setIsSyncing(true)
        operationQueue.processQueue().then(
          () => {
            setIsSyncing(false)
            event.source?.postMessage?.({
              type: 'PROCESS_OPERATION_QUEUE_RESULT',
              success: true,
            })
          },
          (error: Error) => {
            setIsSyncing(false)
            setLastSyncError(error.message)
            event.source?.postMessage?.({
              type: 'PROCESS_OPERATION_QUEUE_RESULT',
              success: false,
              error: error.message,
            })
          }
        )
      }
    }

    navigator.serviceWorker?.addEventListener('message', handleMessage)

    return () => {
      clearInterval(interval)
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [])

  const handleManualSync = async () => {
    setIsSyncing(true)
    setLastSyncError(null)

    try {
      await operationQueue.processQueue()
      setIsSyncing(false)
    } catch (error) {
      setIsSyncing(false)
      setLastSyncError('Manual sync failed')
    }
  }

  const showRealtimeWarning = hasActiveChannels && socketState !== 'open'

  if (queueLength === 0 && !isSyncing && !lastSyncError && !showRealtimeWarning) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
        lastSyncError
          ? 'bg-red-50 text-red-800 border border-red-200'
          : isSyncing || showRealtimeWarning
          ? 'bg-blue-50 text-blue-800 border border-blue-200'
          : queueLength > 0
          ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
          : 'bg-green-50 text-green-800 border border-green-200'
      }`}>
        <div className="flex items-center gap-2">
          {lastSyncError ? (
            <AlertCircle className="w-4 h-4" />
          ) : isSyncing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : queueLength > 0 || showRealtimeWarning ? (
            <RefreshCw className="w-4 h-4" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}

          <span>
            {lastSyncError
              ? `Sync error: ${lastSyncError}`
              : showRealtimeWarning
              ? 'Realtime reconnecting — keeping queue warm'
              : isSyncing
              ? 'Syncing changes...'
              : queueLength > 0
              ? `${queueLength} change${queueLength === 1 ? '' : 's'} pending`
              : 'All changes synced'}
          </span>

          {queueLength > 0 && !isSyncing && (
            <button
              onClick={handleManualSync}
              className="ml-2 px-2 py-1 text-xs bg-white rounded border hover:bg-gray-50"
            >
              Sync now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

### Update `/src/App.tsx`

```typescript
import { SyncStatus } from './components/SyncStatus'
// ... existing imports ...

function App() {
  useEffect(() => {
    // Initialize operation queue
    const initQueue = async () => {
      try {
        await operationQueue.init()
        console.log('Operation queue initialized')
      } catch (error) {
        console.error('Failed to initialize operation queue:', error)
      }
    }

    initQueue()
  }, [])

  return (
    <>
      <NetworkStatus />
      <SyncStatus />
      {/* Rest of your app */}
    </>
  )
}
```

## Testing Criteria

### Unit Tests
- [ ] Operations are added to queue with correct structure
- [ ] Queue persists to localStorage
- [ ] Operations execute successfully when online
- [ ] Failed operations retry with exponential backoff
- [ ] Operations are removed from queue after successful execution

### Integration Tests
- [ ] Create operation while offline gets queued
- [ ] Reconnecting triggers automatic sync
- [ ] Optimistic updates appear immediately in UI
- [ ] Sync status shows correct state
- [ ] Manual sync button works
- [ ] Background sync works when implemented

### Manual Testing
- [ ] Go offline, create an item - should appear optimistically
- [ ] Check that operation is queued
- [ ] Reconnect - should sync automatically
- [ ] Verify item appears on server
- [ ] Test with failed operations (simulate server error)

## Success Metrics
- Operations queue reliably when offline
- Automatic sync works when reconnecting
- UI updates optimistically without delay
- Sync status provides clear feedback
- Failed operations retry appropriately

## Next Steps
After this phase is complete and tested, proceed to Phase 3: Conflict Resolution.