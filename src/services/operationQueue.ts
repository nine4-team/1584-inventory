import { Operation, CreateItemOperation, UpdateItemOperation, DeleteItemOperation } from '../types/operations'
import { offlineStore, type DBOperation } from './offlineStore'
import { supabase, getCurrentUser } from './supabase'
import { conflictDetector } from './conflictDetector'
import { registerBackgroundSync, notifySyncComplete, notifySyncStart } from './serviceWorker'
import { initOfflineContext, getOfflineContext, subscribeToOfflineContext, type OfflineContextValue } from './offlineContext'

type OperationInput = Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'>

interface OperationMetadataOverride {
  accountId?: string
  version?: number
  timestamp?: string
}

export interface OperationQueueSnapshot {
  accountId: string | null
  length: number
  operations: Operation[]
}

type QueueListener = (snapshot: OperationQueueSnapshot) => void

class OperationQueue {
  private queue: Operation[] = []
  private isProcessing = false
  private context: OfflineContextValue | null = null
  private unsubscribeContext: (() => void) | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private legacyImports = new Set<string>()
  private queueListeners = new Set<QueueListener>()

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    if (!this.initPromise) {
      this.initPromise = this.bootstrap()
    }

    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  private async bootstrap(): Promise<void> {
    try {
      await offlineStore.init()
    } catch (error) {
      console.error('Failed to initialize offline store for operation queue:', error)
    }

    await initOfflineContext()
    this.context = getOfflineContext()
    await this.loadQueueForCurrentContext()

    if (!this.unsubscribeContext) {
      this.unsubscribeContext = subscribeToOfflineContext(context => {
        this.handleContextChange(context).catch(error => {
          console.error('Failed to handle offline context change for operation queue:', error)
        })
      })
    }

    this.initialized = true
    this.emitQueueChange()
  }

  async add(operation: OperationInput, metadata: OperationMetadataOverride = {}): Promise<void> {
    await this.init()

    if (!this.context) {
      this.context = getOfflineContext()
    }

    const [currentUser, contextSnapshot] = await Promise.all([
      getCurrentUser().catch(() => null),
      Promise.resolve(this.context)
    ])

    const resolvedAccountId =
      metadata.accountId ?? this.inferAccountId(operation) ?? contextSnapshot?.accountId

    if (!resolvedAccountId) {
      throw new Error('Cannot queue operation until account context is available')
    }

    if (contextSnapshot?.accountId && contextSnapshot.accountId !== resolvedAccountId) {
      throw new Error('Attempted to queue operation for a different account than the active context')
    }

    if (this.queue.length > 0 && this.queue[0].accountId !== resolvedAccountId) {
      throw new Error('Operation queue already contains changes for a different account')
    }

    const resolvedUpdatedBy = currentUser?.id ?? contextSnapshot?.userId
    if (!resolvedUpdatedBy) {
      throw new Error('User must be authenticated to queue operations')
    }

    const resolvedTimestamp = metadata.timestamp ?? new Date().toISOString()
    const resolvedVersion = metadata.version ?? 1
    const fullOperation = {
      ...operation,
      id: crypto.randomUUID(),
      timestamp: resolvedTimestamp,
      retryCount: 0,
      accountId: resolvedAccountId,
      updatedBy: resolvedUpdatedBy,
      version: resolvedVersion
    } as Operation

    this.queue.push(fullOperation)
    await this.persistQueue()
    this.emitQueueChange()

    try {
      await registerBackgroundSync()
    } catch (error) {
      console.warn('Background sync registration failed:', error)
    }

    if (navigator.onLine) {
      void this.processQueue()
    }
  }

  private inferAccountId(operation: OperationInput): string | undefined {
    if ('data' in operation) {
      switch (operation.type) {
        case 'CREATE_ITEM':
          return (operation as CreateItemOperation).data.accountId
        case 'UPDATE_ITEM':
          return (operation as UpdateItemOperation).data.accountId
        case 'DELETE_ITEM':
          return (operation as DeleteItemOperation).data.accountId
        default:
          return undefined
      }
    }
    return undefined
  }

  private async handleContextChange(nextContext: OfflineContextValue | null): Promise<void> {
    if (this.context?.accountId && this.context.accountId !== nextContext?.accountId) {
      await this.persistQueue()
    }

    this.context = nextContext
    await this.loadQueueForCurrentContext()
  }

  private async loadQueueForCurrentContext(): Promise<void> {
    if (!this.context?.accountId) {
      this.queue = []
      return
    }

    try {
      await this.importLegacyQueueIfNeeded(this.context)
      const operations = await offlineStore.getOperations(this.context.accountId)
      this.queue = operations.map(op => ({
        id: op.id,
        type: op.type as Operation['type'],
        timestamp: op.timestamp,
        retryCount: op.retryCount,
        lastError: op.lastError,
        accountId: op.accountId,
        updatedBy: op.updatedBy,
        version: op.version,
        data: op.data
      } as Operation))
      this.emitQueueChange()
    } catch (error) {
      console.error('Failed to load operation queue:', error)
      this.queue = []
      this.emitQueueChange()
    }
  }

  private async importLegacyQueueIfNeeded(context: OfflineContextValue): Promise<void> {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return
    }

    if (this.legacyImports.has(context.accountId)) {
      return
    }

    const legacyKey = 'operation-queue'
    const raw = window.localStorage.getItem(legacyKey)

    if (!raw) {
      this.legacyImports.add(context.accountId)
      return
    }

    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        window.localStorage.removeItem(legacyKey)
        return
      }

      const normalized = parsed
        .map(entry => this.normalizeLegacyOperation(entry, context))
        .filter((op): op is DBOperation => Boolean(op))

      if (normalized.length === 0) {
        window.localStorage.removeItem(legacyKey)
        return
      }

      const existing = await offlineStore.getOperations(context.accountId)
      const existingIds = new Set(existing.map(op => op.id))
      const merged = [
        ...normalized.filter(op => !existingIds.has(op.id)),
        ...existing
      ]

      await offlineStore.replaceOperationsForAccount(context.accountId, merged)
      window.localStorage.removeItem(legacyKey)
    } catch (error) {
      console.warn('Failed to migrate legacy operation queue from localStorage:', error)
    } finally {
      this.legacyImports.add(context.accountId)
    }
  }

  private normalizeLegacyOperation(entry: any, context: OfflineContextValue): DBOperation | null {
    if (!entry || typeof entry !== 'object' || !entry.type) {
      return null
    }

    const accountId = entry.accountId ?? context.accountId
    const updatedBy = entry.updatedBy ?? context.userId

    if (!accountId || !updatedBy) {
      return null
    }

    return {
      id: entry.id ?? crypto.randomUUID(),
      type: entry.type,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      retryCount: entry.retryCount ?? 0,
      lastError: entry.lastError,
      accountId,
      updatedBy,
      version: entry.version ?? 1,
      data: entry.data ?? {}
    }
  }

  async processQueue(): Promise<void> {
    await this.init()

    if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) {
      return
    }

    notifySyncStart({
      source: 'foreground',
      pendingOperations: this.queue.length
    })

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

      // Validate that the current user matches the operation's updatedBy
      // This ensures offline-queued operations can only be processed by the user who created them
      if (operation.updatedBy !== currentUser.id) {
        console.warn(
          `Operation ${operation.id} was queued by user ${operation.updatedBy} but current user is ${currentUser.id}. Skipping.`
        )
        // Remove the operation as it cannot be processed by this user
        this.queue.shift()
        await this.persistQueue()
        this.emitQueueChange()
        this.isProcessing = false
        // Continue processing next operation
        setTimeout(() => this.processQueue(), 100)
        return
      }

      const success = await this.executeOperation(operation)

      if (success) {
        this.queue.shift() // Remove completed operation
        await this.persistQueue()
        this.emitQueueChange()

        // Notify sync completion if queue is now empty
        if (this.queue.length === 0) {
          notifySyncComplete({ pendingOperations: 0 })
        }

        // Process next operation
        setTimeout(() => this.processQueue(), 100)
      } else {
        // Check for conflicts before retrying
        // Conflicts are detected and stored in IndexedDB by conflictDetector.detectConflicts
        // The UI (ConflictResolutionView) will load and display them
        const projectId = this.getProjectIdFromOperation(operation)
        if (projectId) {
          const conflicts = await conflictDetector.detectConflicts(projectId)
          if (conflicts.length > 0) {
            console.warn('Conflicts detected during sync, marking operation as blocked:', conflicts)
            operation.lastError = `Conflicts detected (${conflicts.length} item(s)) - please resolve conflicts in the UI`
            operation.retryCount = 5 // Mark as permanently failed due to conflicts
            await this.persistQueue()
            this.emitQueueChange() // Notify UI that queue state changed
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
          this.emitQueueChange()
        } else {
          // Schedule retry
          const delay = Math.min(1000 * Math.pow(2, operation.retryCount), 30000)
          setTimeout(() => this.processQueue(), delay)
        }

        await this.persistQueue()
        this.emitQueueChange()
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
      // Check for conflicts before executing
      // Conflicts are detected and stored in IndexedDB by conflictDetector.detectConflicts
      // The UI (ConflictResolutionView) will load and display them
      const projectId = this.getProjectIdFromOperation(operation)
      if (projectId) {
        const conflicts = await conflictDetector.detectConflicts(projectId)
        if (conflicts.length > 0) {
          console.warn('Conflicts detected, blocking operation execution:', conflicts)
          // Conflicts are already stored in IndexedDB by conflictDetector
          // UI will surface them via ConflictResolutionView
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

      // Cache in local store with camelCase fields so downstream logic has account metadata
      const cachedAt = new Date().toISOString()
      const dbItem = {
        itemId: serverItem.id,
        accountId,
        projectId: data.projectId,
        name: serverItem.name,
        description: serverItem.description ?? '',
        source: serverItem.source ?? 'manual',
        sku: serverItem.sku ?? '',
        paymentMethod: serverItem.payment_method ?? 'cash',
        disposition: serverItem.disposition ?? null,
        notes: serverItem.notes ?? undefined,
        qrKey: serverItem.qr_key,
        bookmark: serverItem.bookmark ?? false,
        dateCreated: serverItem.date_created ?? cachedAt,
        lastUpdated: serverItem.last_updated ?? cachedAt,
        version: version,
        last_synced_at: cachedAt
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
      const existingItems = await offlineStore.getAllItems()
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
    const activeAccountId = this.getActiveAccountId()
    if (!activeAccountId) {
      return
    }

    const mixedAccounts = this.queue.some(op => op.accountId !== activeAccountId)
    if (mixedAccounts) {
      console.error('Operation queue contains multiple account IDs. Skipping persistence to avoid corruption.')
      return
    }

    try {
      const operations: DBOperation[] = this.queue.map(op => ({
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
      await offlineStore.replaceOperationsForAccount(activeAccountId, operations)
    } catch (error) {
      console.error('Failed to persist operation queue:', error)
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  getSnapshot(): OperationQueueSnapshot {
    return {
      accountId: this.getActiveAccountId(),
      length: this.queue.length,
      operations: [...this.queue]
    }
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

  async clearQueue(accountId?: string): Promise<void> {
    await this.init()
    const previousAccountId = this.queue[0]?.accountId ?? this.context?.accountId
    this.queue = []
    const targetAccountId = accountId ?? previousAccountId

    try {
      if (targetAccountId) {
        await offlineStore.clearOperations(targetAccountId)
      } else {
        await offlineStore.clearOperations()
      }
    } catch (error) {
      console.error('Failed to clear operations from store:', error)
    }
    this.emitQueueChange()
  }

  subscribe(listener: QueueListener): () => void {
    this.queueListeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.queueListeners.delete(listener)
    }
  }

  private emitQueueChange(): void {
    if (this.queueListeners.size === 0) {
      return
    }
    const snapshot = this.getSnapshot()
    this.queueListeners.forEach(listener => {
      try {
        listener(snapshot)
      } catch (error) {
        console.warn('Operation queue listener failed', error)
      }
    })
  }

  private getActiveAccountId(): string | null {
    return this.queue[0]?.accountId ?? this.context?.accountId ?? null
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
            success: true,
            pendingOperations: operationQueue.getQueueLength()
          })
        })
        .catch(error => {
          console.error('Failed to process operation queue from service worker request:', error)
          responsePort?.postMessage({
            type: 'PROCESS_OPERATION_QUEUE_RESULT',
            success: false,
            error: error?.message,
            pendingOperations: operationQueue.getQueueLength()
          })
        })
    }
  })
}