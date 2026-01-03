import { Operation, CreateItemOperation, UpdateItemOperation, DeleteItemOperation } from '../types/operations'
import { offlineStore, type DBOperation, type DBItem } from './offlineStore'
import { supabase, getCurrentUser } from './supabase'
import { conflictDetector } from './conflictDetector'
import {
  registerBackgroundSync,
  notifySyncComplete,
  notifySyncStart,
  type BackgroundSyncRegistrationResult
} from './serviceWorker'
import {
  initOfflineContext,
  getOfflineContext,
  subscribeToOfflineContext,
  type OfflineContextValue,
  getLastKnownUserId
} from './offlineContext'
import type { ConflictItem } from '../types/conflicts'
import { isNetworkOnline } from './networkStatusService'

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
  lastEnqueueAt: string | null
  lastOfflineEnqueueAt: string | null
  lastEnqueueError: string | null
  backgroundSyncAvailable: boolean | null
  backgroundSyncReason: string | null
}

type QueueListener = (snapshot: OperationQueueSnapshot) => void

export class OfflineContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfflineContextError'
  }
}

class OperationQueue {
  private queue: Operation[] = []
  private isProcessing = false
  private context: OfflineContextValue | null = null
  private unsubscribeContext: (() => void) | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private legacyImports = new Set<string>()
  private queueListeners = new Set<QueueListener>()
  private lastResolvedUserId: string | null = null
  private lastEnqueueAt: string | null = null
  private lastOfflineEnqueueAt: string | null = null
  private lastEnqueueError: string | null = null
  private backgroundSyncAvailable: boolean | null = null
  private backgroundSyncReason: string | null = null

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

  async add(operation: OperationInput, metadata: OperationMetadataOverride = {}): Promise<string> {
    await this.init()

    try {
      if (!this.context) {
        this.context = getOfflineContext()
      }

      const contextSnapshot = this.context
      const resolvedAccountId =
        metadata.accountId ?? this.inferAccountId(operation) ?? contextSnapshot?.accountId

      if (!resolvedAccountId) {
        throw new OfflineContextError('Cannot queue operation until account context is available')
      }

      if (contextSnapshot?.accountId && contextSnapshot.accountId !== resolvedAccountId) {
        throw new OfflineContextError('Attempted to queue operation for a different account than the active context')
      }

      if (this.queue.length > 0 && this.queue[0].accountId !== resolvedAccountId) {
        throw new OfflineContextError('Operation queue already contains changes for a different account')
      }

      let resolvedUpdatedBy =
        contextSnapshot?.userId ??
        this.lastResolvedUserId ??
        getLastKnownUserId()
      const usedCachedUser = Boolean(resolvedUpdatedBy)

      if (!resolvedUpdatedBy) {
        // Emit structured log when cached context is missing
        const logData = {
          accountId: resolvedAccountId,
          operationType: operation.type,
          hasContextSnapshot: Boolean(contextSnapshot),
          hasLastResolvedUserId: Boolean(this.lastResolvedUserId),
          hasLastKnownUserId: Boolean(getLastKnownUserId()),
          isOnline: isNetworkOnline()
        }
        
        if (isNetworkOnline()) {
          console.warn('[operationQueue] cached user context missing, falling back to getCurrentUser', logData)
          try {
            const currentUser = await getCurrentUser()
            resolvedUpdatedBy = currentUser?.id ?? null
            if (resolvedUpdatedBy) {
              console.info('[operationQueue] successfully resolved user from getCurrentUser', {
                accountId: resolvedAccountId,
                userId: resolvedUpdatedBy,
                operationType: operation.type
              })
            } else {
              console.warn('[operationQueue] getCurrentUser returned null user', logData)
            }
          } catch (error) {
            console.error('[operationQueue] failed to fetch authenticated user for operation queue', {
              ...logData,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        } else {
          console.error('[operationQueue] cached user context missing while offline, cannot queue operation', logData)
          throw new OfflineContextError('Sign in before working offline so we can attribute queued work.')
        }
      }

      if (!resolvedUpdatedBy) {
        throw new OfflineContextError('Unable to determine user for queued operation. Please refresh or sign in again.')
      }

      const resolvedTimestamp = metadata.timestamp ?? new Date().toISOString()
      const resolvedVersion = metadata.version ?? 1
      const operationId = crypto.randomUUID()
      const offlineEnqueue = !isNetworkOnline()
      const fullOperation = {
        ...operation,
        id: operationId,
        timestamp: resolvedTimestamp,
        retryCount: 0,
        accountId: resolvedAccountId,
        updatedBy: resolvedUpdatedBy,
        version: resolvedVersion
      } as Operation

      this.lastResolvedUserId = resolvedUpdatedBy
      this.lastEnqueueAt = resolvedTimestamp
      if (offlineEnqueue) {
        this.lastOfflineEnqueueAt = resolvedTimestamp
      }
      this.lastEnqueueError = null

      if (usedCachedUser && import.meta.env.DEV) {
        console.info('[operationQueue] using cached user context for enqueue', {
          accountId: resolvedAccountId,
          userId: resolvedUpdatedBy,
          operationType: operation.type
        })
      }

      if (offlineEnqueue && import.meta.env.DEV) {
        console.info('[operationQueue] queued operation while offline', {
          accountId: resolvedAccountId,
          operationId,
          operationType: operation.type
        })
      }

      this.queue.push(fullOperation)
      await this.persistQueue()
      this.emitQueueChange()
      this.ensureBackgroundSyncRegistration()

      if (isNetworkOnline()) {
        void this.processQueue()
      }

      return operationId
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enqueue operation'
      this.lastEnqueueError = message
      this.emitQueueChange()
      throw error
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

    if (this.isProcessing || this.queue.length === 0 || !isNetworkOnline()) {
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
          this.lastOfflineEnqueueAt = null // Clear offline enqueue timestamp when queue is empty
          notifySyncComplete({ pendingOperations: 0 })
        }

        // Process next operation
        setTimeout(() => this.processQueue(), 100)
      } else {
        // Check for conflicts before retrying
        // Conflicts are detected and stored in IndexedDB by conflictDetector.detectConflicts
        // The UI (ConflictResolutionView) will load and display them
        const projectId = await this.resolveProjectId(operation)
        if (projectId) {
          const conflicts = await conflictDetector.detectConflicts(projectId)
          if (this.shouldBlockOperation(operation, conflicts)) {
            const targetItemId = this.getOperationTargetItemId(operation)
            const blockingConflicts = conflicts.filter(conflict => conflict.id === targetItemId)
            console.warn('Conflicts detected for operation, marking as blocked', {
              operationId: operation.id,
              conflictingItems: blockingConflicts.map(conflict => conflict.id)
            })
            operation.lastError = targetItemId
              ? `Conflicts detected for item ${targetItemId}`
              : 'Conflicts detected - please resolve before retrying'
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
      const projectId = await this.resolveProjectId(operation)
      if (projectId) {
        const conflicts = await conflictDetector.detectConflicts(projectId)
        if (this.shouldBlockOperation(operation, conflicts)) {
          console.warn('Conflicts detected for queued operation, delaying execution', {
            operationId: operation.id,
            conflictingItems: conflicts.map(conflict => conflict.id)
          })
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
      default:
        return null
    }
  }

  private async resolveProjectId(operation: Operation): Promise<string | null> {
    const directProjectId = this.getProjectIdFromOperation(operation)
    if (directProjectId) {
      return directProjectId
    }

    const targetItemId = this.getOperationTargetItemId(operation)
    if (!targetItemId) {
      return null
    }

    try {
      const localItem = await offlineStore.getItemById(targetItemId)
      return localItem?.projectId ?? null
    } catch (error) {
      console.warn('Failed to resolve projectId for operation from offline store', {
        operationId: operation.id,
        targetItemId,
        error
      })
      return null
    }
  }

  private async executeCreateItem(operation: CreateItemOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full item data from local store - it has all the user's actual data
      // This prevents conflicts by ensuring server gets the same data as local store
      const localItem = await offlineStore.getItemById(data.id)
      
      if (!localItem) {
        console.error(`Cannot create item: local item ${data.id} not found in offline store`)
        return false
      }

      // Create on server using the FULL item data from local store, not just operation data
      // This ensures source, sku, paymentMethod, qrKey, etc. match what user entered
      const { data: serverItem, error } = await supabase
        .from('items')
        .insert({
          item_id: data.id, // CRITICAL: item_id is required and must be provided
          account_id: accountId,
          project_id: localItem.projectId ?? data.projectId,
          transaction_id: localItem.transactionId ?? null,
          previous_project_transaction_id: localItem.previousProjectTransactionId ?? null,
          previous_project_id: localItem.previousProjectId ?? null,
          name: localItem.name ?? data.name ?? null,
          description: localItem.description ?? data.description ?? null,
          source: localItem.source ?? null, // NO DEFAULTS - send null if missing
          sku: localItem.sku ?? null, // NO DEFAULTS - send null if missing
          payment_method: localItem.paymentMethod ?? null, // NO DEFAULTS - send null if missing
          qr_key: localItem.qrKey ?? null, // NO DEFAULTS - send null if missing (should be set during creation)
          bookmark: localItem.bookmark ?? false,
          disposition: localItem.disposition ?? null,
          notes: localItem.notes ?? undefined,
          space: localItem.space ?? undefined,
          purchase_price: localItem.purchasePrice ?? undefined,
          project_price: localItem.projectPrice ?? undefined,
          market_value: localItem.marketValue ?? undefined,
          tax_rate_pct: localItem.taxRatePct ?? undefined,
          tax_amount_purchase_price: localItem.taxAmountPurchasePrice ?? undefined,
          tax_amount_project_price: localItem.taxAmountProjectPrice ?? undefined,
          inventory_status: localItem.inventoryStatus ?? undefined,
          business_inventory_location: localItem.businessInventoryLocation ?? undefined,
          origin_transaction_id: localItem.originTransactionId ?? null,
          latest_transaction_id: localItem.latestTransactionId ?? null,
          images: localItem.images ?? [],
          date_created: localItem.dateCreated || new Date().toISOString(),
          created_at: localItem.createdAt || localItem.dateCreated || new Date().toISOString(),
          last_updated: localItem.lastUpdated || new Date().toISOString(),
          created_by: localItem.createdBy || updatedBy,
          updated_by: updatedBy,
          version: version
        })
        .select()
        .single()

      if (error) throw error

      // Update local store with server response (which should match what we sent)
      // This ensures local and server are in sync
      const cachedAt = new Date().toISOString()
      const dbItem: DBItem = {
        itemId: serverItem.item_id || data.id,
        accountId,
        projectId: serverItem.project_id ?? localItem.projectId ?? null,
        transactionId: serverItem.transaction_id ?? localItem.transactionId ?? null,
        previousProjectTransactionId: serverItem.previous_project_transaction_id ?? localItem.previousProjectTransactionId ?? null,
        previousProjectId: serverItem.previous_project_id ?? localItem.previousProjectId ?? null,
        name: serverItem.name ?? localItem.name,
        description: serverItem.description ?? localItem.description ?? '',
        source: serverItem.source ?? localItem.source ?? null, // NO DEFAULTS
        sku: serverItem.sku ?? localItem.sku ?? null, // NO DEFAULTS
        paymentMethod: serverItem.payment_method ?? localItem.paymentMethod ?? null, // NO DEFAULTS
        disposition: serverItem.disposition ?? localItem.disposition ?? null,
        notes: serverItem.notes ?? localItem.notes ?? undefined,
        space: serverItem.space ?? localItem.space ?? undefined,
        qrKey: serverItem.qr_key ?? localItem.qrKey,
        bookmark: serverItem.bookmark ?? localItem.bookmark ?? false,
        purchasePrice: serverItem.purchase_price ?? localItem.purchasePrice ?? undefined,
        projectPrice: serverItem.project_price ?? localItem.projectPrice ?? undefined,
        marketValue: serverItem.market_value ?? localItem.marketValue ?? undefined,
        taxRatePct: serverItem.tax_rate_pct ?? localItem.taxRatePct ?? undefined,
        taxAmountPurchasePrice: serverItem.tax_amount_purchase_price ?? localItem.taxAmountPurchasePrice ?? undefined,
        taxAmountProjectPrice: serverItem.tax_amount_project_price ?? localItem.taxAmountProjectPrice ?? undefined,
        inventoryStatus: serverItem.inventory_status ?? localItem.inventoryStatus ?? undefined,
        businessInventoryLocation: serverItem.business_inventory_location ?? localItem.businessInventoryLocation ?? undefined,
        originTransactionId: serverItem.origin_transaction_id ?? localItem.originTransactionId ?? null,
        latestTransactionId: serverItem.latest_transaction_id ?? localItem.latestTransactionId ?? null,
        dateCreated: serverItem.date_created ?? localItem.dateCreated ?? cachedAt,
        lastUpdated: serverItem.last_updated ?? localItem.lastUpdated ?? cachedAt,
        createdAt: serverItem.created_at ?? localItem.createdAt ?? cachedAt,
        images: serverItem.images ?? localItem.images ?? [],
        createdBy: serverItem.created_by ?? localItem.createdBy ?? updatedBy,
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

  private getOperationTargetItemId(operation: Operation): string | null {
    switch (operation.type) {
      case 'CREATE_ITEM':
      case 'UPDATE_ITEM':
      case 'DELETE_ITEM':
        return operation.data.id
      default:
        return null
    }
  }

  private shouldBlockOperation(operation: Operation, conflicts: ConflictItem[]): boolean {
    if (conflicts.length === 0) {
      return false
    }

    // CREATE_ITEM operations cannot conflict until after insertion succeeds
    if (operation.type === 'CREATE_ITEM') {
      return false
    }

    const targetItemId = this.getOperationTargetItemId(operation)
    if (!targetItemId) {
      return false
    }

    return conflicts.some(conflict => conflict.id === targetItemId)
  }

  private async executeUpdateItem(operation: UpdateItemOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full item data from local store - it has all the user's actual data
      // This prevents conflicts by ensuring server gets the same data as local store
      const localItem = await offlineStore.getItemById(data.id)
      
      if (!localItem) {
        console.error(`Cannot update item: local item ${data.id} not found in offline store`)
        return false
      }

      // Merge the operation updates into the full local item
      // The operation may only have simplified fields, but localItem has everything
      const updatedLocalItem: DBItem = {
        ...localItem,
        // Apply any updates from the operation (though localItem should already have them)
        ...(data.updates.name !== undefined && { name: data.updates.name }),
        ...(data.updates.description !== undefined && { description: data.updates.description }),
        lastUpdated: new Date().toISOString(),
        version: version
      }

      // Update on server using the FULL item data from local store, not just operation updates
      // This ensures source, sku, paymentMethod, qrKey, purchasePrice, projectPrice, etc. 
      // all match what user actually entered
      const { data: serverItem, error } = await supabase
        .from('items')
        .update({
          // Send all fields from the updated local item, not just the 4 simplified fields
          project_id: updatedLocalItem.projectId ?? null,
          transaction_id: updatedLocalItem.transactionId ?? null,
          previous_project_transaction_id: updatedLocalItem.previousProjectTransactionId ?? null,
          previous_project_id: updatedLocalItem.previousProjectId ?? null,
          name: updatedLocalItem.name ?? null,
          description: updatedLocalItem.description ?? null,
          source: updatedLocalItem.source ?? null, // NO DEFAULTS - send null if missing
          sku: updatedLocalItem.sku ?? null, // NO DEFAULTS - send null if missing
          payment_method: updatedLocalItem.paymentMethod ?? null, // NO DEFAULTS - send null if missing
          qr_key: updatedLocalItem.qrKey ?? null, // NO DEFAULTS - send null if missing
          bookmark: updatedLocalItem.bookmark ?? false,
          disposition: updatedLocalItem.disposition ?? null,
          notes: updatedLocalItem.notes ?? undefined,
          space: updatedLocalItem.space ?? undefined,
          purchase_price: updatedLocalItem.purchasePrice ?? undefined,
          project_price: updatedLocalItem.projectPrice ?? undefined,
          market_value: updatedLocalItem.marketValue ?? undefined,
          tax_rate_pct: updatedLocalItem.taxRatePct ?? undefined,
          tax_amount_purchase_price: updatedLocalItem.taxAmountPurchasePrice ?? undefined,
          tax_amount_project_price: updatedLocalItem.taxAmountProjectPrice ?? undefined,
          inventory_status: updatedLocalItem.inventoryStatus ?? undefined,
          business_inventory_location: updatedLocalItem.businessInventoryLocation ?? undefined,
          origin_transaction_id: updatedLocalItem.originTransactionId ?? null,
          latest_transaction_id: updatedLocalItem.latestTransactionId ?? null,
          images: updatedLocalItem.images ?? [],
          last_updated: updatedLocalItem.lastUpdated || new Date().toISOString(),
          updated_by: updatedBy,
          version: version
        })
        .eq('item_id', data.id)
        .select()
        .single()

      if (error) throw error

      // Update local store with server response (which should match what we sent)
      // This ensures local and server are in sync
      const cachedAt = new Date().toISOString()
      const dbItem: DBItem = {
        itemId: serverItem.item_id || data.id,
        accountId,
        projectId: serverItem.project_id ?? updatedLocalItem.projectId ?? null,
        transactionId: serverItem.transaction_id ?? updatedLocalItem.transactionId ?? null,
        previousProjectTransactionId: serverItem.previous_project_transaction_id ?? updatedLocalItem.previousProjectTransactionId ?? null,
        previousProjectId: serverItem.previous_project_id ?? updatedLocalItem.previousProjectId ?? null,
        name: serverItem.name ?? updatedLocalItem.name,
        description: serverItem.description ?? updatedLocalItem.description ?? '',
        source: serverItem.source ?? updatedLocalItem.source ?? null, // NO DEFAULTS
        sku: serverItem.sku ?? updatedLocalItem.sku ?? null, // NO DEFAULTS
        paymentMethod: serverItem.payment_method ?? updatedLocalItem.paymentMethod ?? null, // NO DEFAULTS
        disposition: serverItem.disposition ?? updatedLocalItem.disposition ?? null,
        notes: serverItem.notes ?? updatedLocalItem.notes ?? undefined,
        space: serverItem.space ?? updatedLocalItem.space ?? undefined,
        qrKey: serverItem.qr_key ?? updatedLocalItem.qrKey,
        bookmark: serverItem.bookmark ?? updatedLocalItem.bookmark ?? false,
        purchasePrice: serverItem.purchase_price ?? updatedLocalItem.purchasePrice ?? undefined,
        projectPrice: serverItem.project_price ?? updatedLocalItem.projectPrice ?? undefined,
        marketValue: serverItem.market_value ?? updatedLocalItem.marketValue ?? undefined,
        taxRatePct: serverItem.tax_rate_pct ?? updatedLocalItem.taxRatePct ?? undefined,
        taxAmountPurchasePrice: serverItem.tax_amount_purchase_price ?? updatedLocalItem.taxAmountPurchasePrice ?? undefined,
        taxAmountProjectPrice: serverItem.tax_amount_project_price ?? updatedLocalItem.taxAmountProjectPrice ?? undefined,
        inventoryStatus: serverItem.inventory_status ?? updatedLocalItem.inventoryStatus ?? undefined,
        businessInventoryLocation: serverItem.business_inventory_location ?? updatedLocalItem.businessInventoryLocation ?? undefined,
        originTransactionId: serverItem.origin_transaction_id ?? updatedLocalItem.originTransactionId ?? null,
        latestTransactionId: serverItem.latest_transaction_id ?? updatedLocalItem.latestTransactionId ?? null,
        lastUpdated: serverItem.last_updated ?? updatedLocalItem.lastUpdated ?? cachedAt,
        dateCreated: serverItem.date_created ?? updatedLocalItem.dateCreated ?? cachedAt,
        createdAt: serverItem.created_at ?? updatedLocalItem.createdAt ?? cachedAt,
        images: serverItem.images ?? updatedLocalItem.images ?? [],
        createdBy: serverItem.created_by ?? updatedLocalItem.createdBy,
        version: version,
        last_synced_at: cachedAt
      }
      await offlineStore.saveItems([dbItem])

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
      operations: [...this.queue],
      lastEnqueueAt: this.lastEnqueueAt,
      lastOfflineEnqueueAt: this.lastOfflineEnqueueAt,
      lastEnqueueError: this.lastEnqueueError,
      backgroundSyncAvailable: this.backgroundSyncAvailable,
      backgroundSyncReason: this.backgroundSyncReason
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
    this.lastOfflineEnqueueAt = null // Clear offline enqueue timestamp when queue is cleared
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

  private ensureBackgroundSyncRegistration(): void {
    if (typeof window === 'undefined') {
      return
    }
    
    // Fire-and-forget: don't block operationQueue.add on background sync registration
    // This ensures operations can be queued even if service worker isn't ready
    void registerBackgroundSync()
      .then(result => {
        this.captureBackgroundSyncStatus(result)
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : 'register-error'
        this.captureBackgroundSyncStatus({
          enabled: false,
          supported: false,
          reason: message
        })
      })
  }

  private captureBackgroundSyncStatus(result: BackgroundSyncRegistrationResult): void {
    const nextAvailable = result.enabled
    const nextReason = result.enabled ? null : (result.reason ?? (result.supported ? 'unknown' : 'unsupported'))

    if (this.backgroundSyncAvailable === nextAvailable && this.backgroundSyncReason === nextReason) {
      return
    }

    if (import.meta.env.DEV && nextAvailable === false && nextReason) {
      console.warn('[operationQueue] background sync unavailable', {
        reason: nextReason
      })
    }

    this.backgroundSyncAvailable = nextAvailable
    this.backgroundSyncReason = nextReason
    this.emitQueueChange()
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