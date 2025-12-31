import { Operation, CreateItemOperation, UpdateItemOperation, DeleteItemOperation } from '../types/operations'
import { offlineStore } from './offlineStore'
import { supabase, getCurrentUser } from './supabase'
import { conflictDetector } from './conflictDetector'
import { registerBackgroundSync, notifySyncComplete } from './serviceWorker'

class OperationQueue {
  private queue: Operation[] = []
  private isProcessing = false

  async init(): Promise<void> {
    // Load queued operations from IndexedDB
    try {
      const operations = await offlineStore.getOperations()
      this.queue = operations.map(op => ({
        id: op.id,
        type: op.type as any,
        timestamp: op.timestamp,
        retryCount: op.retryCount,
        lastError: op.lastError,
        accountId: op.accountId,
        updatedBy: op.updatedBy,
        version: op.version,
        data: op.data
      } as Operation))
    } catch (error) {
      console.error('Failed to load operation queue:', error)
      this.queue = []
    }
  }

  async add(operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'>): Promise<void> {
    // Get current user and account info
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      throw new Error('User must be authenticated to queue operations')
    }

    // For now, we'll assume account ID comes from the operation data or user context
    // This will need to be updated when we have proper account context
    const accountId = operation.type.includes('ITEM')
      ? (operation as any).data.accountId || 'default-account'
      : 'default-account'

    const fullOperation = {
      ...operation,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      retryCount: 0,
      accountId,
      updatedBy: currentUser.id,
      version: 1 // Initial version
    } as Operation

    this.queue.push(fullOperation)
    await this.persistQueue()

    // Register Background Sync for reliability
    try {
      await registerBackgroundSync()
    } catch (error) {
      console.warn('Background sync registration failed:', error)
    }

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
      // Ensure auth session is fresh before processing operations
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        console.warn('No authenticated user found, skipping queue processing')
        this.isProcessing = false
        return
      }

      // Refresh auth session if needed
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session) {
          console.warn('Auth session invalid, skipping queue processing')
          this.isProcessing = false
          return
        }

        // Refresh token if it's close to expiry (within 5 minutes)
        const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : null
        if (expiresAt && expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
          const { error: refreshError } = await supabase.auth.refreshSession()
          if (refreshError) {
            console.warn('Failed to refresh auth session:', refreshError.message)
            this.isProcessing = false
            return
          }
        }
      } catch (authError) {
        console.error('Auth check failed:', authError)
        this.isProcessing = false
        return
      }

      const operation = this.queue[0] // Process FIFO

      const success = await this.executeOperation(operation)

      if (success) {
        this.queue.shift() // Remove completed operation
        await this.persistQueue()

        // Notify sync completion if queue is now empty
        if (this.queue.length === 0) {
          notifySyncComplete()
        }

        // Process next operation
        setTimeout(() => this.processQueue(), 100)
      } else {
        // Check for conflicts before retrying
        const projectId = this.getProjectIdFromOperation(operation)
        if (projectId) {
          const conflicts = await conflictDetector.detectConflicts(projectId)
          if (conflicts.length > 0) {
            console.warn('Conflicts detected during sync, marking operation as blocked:', conflicts)
            operation.lastError = 'Conflicts detected - manual resolution required'
            operation.retryCount = 5 // Mark as permanently failed due to conflicts
            await this.persistQueue()
            // Don't process next operation - let UI handle conflict resolution
            this.isProcessing = false
            return
          }
        }

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
      // Check for conflicts before executing (Phase 3: Conflict Resolution)
      const projectId = this.getProjectIdFromOperation(operation)
      if (projectId) {
        const conflicts = await conflictDetector.detectConflicts(projectId)
        if (conflicts.length > 0) {
          // For now, log conflicts and skip execution
          // In Phase 4, we'll integrate with UI for resolution
          console.warn('Conflicts detected, skipping operation:', conflicts)
          return false
        }
      }

      switch (operation.type) {
        case 'CREATE_ITEM':
          return await this.executeCreateItem(operation)
        case 'UPDATE_ITEM':
          return await this.executeUpdateItem(operation)
        case 'DELETE_ITEM':
          return await this.executeDeleteItem(operation)
        default:
          console.error('Unknown operation type:', operation.type)
          return false
      }
    } catch (error) {
      console.error('Failed to execute operation:', error)
      return false
    }
  }

  private getProjectIdFromOperation(operation: Operation): string | null {
    switch (operation.type) {
      case 'CREATE_ITEM':
        return (operation as CreateItemOperation).data.projectId
      case 'UPDATE_ITEM':
        // UPDATE_ITEM doesn't have projectId in the current operation structure
        // We'll need to look up the item to get projectId, but for now skip conflict detection
        return null
      case 'DELETE_ITEM':
        // DELETE_ITEM doesn't have projectId in the current operation structure
        // We'll need to look up the item to get projectId, but for now skip conflict detection
        return null
      default:
        return null
    }
  }

  private async executeCreateItem(operation: CreateItemOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Create on server first
      const { data: serverItem, error } = await supabase
        .from('items')
        .insert({
          account_id: accountId,
          project_id: data.projectId,
          name: data.name,
          description: data.description,
          // Add other required fields with defaults
          source: 'manual',
          sku: `TEMP-${Date.now()}`,
          payment_method: 'cash',
          qr_key: crypto.randomUUID(),
          bookmark: false,
          date_created: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          created_by: updatedBy,
          updated_by: updatedBy,
          version: version
        })
        .select()
        .single()

      if (error) throw error

      // Cache in local store
      const dbItem = {
        ...serverItem,
        itemId: serverItem.id,
        version: version,
        last_synced_at: new Date().toISOString()
      }
      await offlineStore.saveItems([dbItem])

      return true
    } catch (error) {
      console.error('Failed to create item on server:', error)
      return false
    }
  }

  private async executeUpdateItem(operation: UpdateItemOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Update server first
      const { error } = await supabase
        .from('items')
        .update({
          ...data.updates,
          updated_by: updatedBy,
          version: version,
          last_updated: new Date().toISOString()
        })
        .eq('item_id', data.id)

      if (error) throw error

      // Update local store
      const existingItems = await offlineStore.getItems('') // Get all items for now
      const itemToUpdate = existingItems.find(item => item.itemId === data.id)

      if (itemToUpdate) {
        const updatedItem = {
          ...itemToUpdate,
          ...data.updates,
          lastUpdated: new Date().toISOString(),
          version: version,
          updated_by: updatedBy,
          last_synced_at: new Date().toISOString()
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
    const { data, accountId, updatedBy, version } = operation

    try {
      // Delete from server
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('item_id', data.id)

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
      const operations = this.queue.map(op => ({
        id: op.id,
        type: op.type,
        timestamp: op.timestamp,
        retryCount: op.retryCount,
        lastError: op.lastError,
        accountId: op.accountId,
        updatedBy: op.updatedBy,
        version: op.version,
        data: (op as any).data || {}
      }))
      await offlineStore.saveOperations(operations)
    } catch (error) {
      console.error('Failed to persist operation queue:', error)
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getPendingOperations(): Operation[] {
    return this.queue.map(op => ({
      id: op.id,
      type: op.type,
      timestamp: op.timestamp,
      retryCount: op.retryCount,
      lastError: op.lastError,
      accountId: op.accountId,
      updatedBy: op.updatedBy,
      version: op.version,
      ...(op as any).data ? { data: (op as any).data } : {}
    } as Operation))
  }

  async clearQueue(): Promise<void> {
    this.queue = []
    try {
      await offlineStore.clearOperations()
    } catch (error) {
      console.error('Failed to clear operations from store:', error)
    }
  }
}

export const operationQueue = new OperationQueue()

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'PROCESS_OPERATION_QUEUE') {
      const responsePort = event.ports && event.ports[0]
      operationQueue
        .processQueue()
        .then(() => {
          responsePort?.postMessage({
            type: 'PROCESS_OPERATION_QUEUE_RESULT',
            success: true
          })
        })
        .catch(error => {
          console.error('Failed to process operation queue from service worker request:', error)
          responsePort?.postMessage({
            type: 'PROCESS_OPERATION_QUEUE_RESULT',
            success: false,
            error: error?.message
          })
        })
    }
  })
}