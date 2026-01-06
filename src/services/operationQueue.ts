import {
  Operation,
  CreateItemOperation,
  UpdateItemOperation,
  DeleteItemOperation,
  CreateTransactionOperation,
  UpdateTransactionOperation,
  DeleteTransactionOperation,
  CreateProjectOperation,
  UpdateProjectOperation,
  DeleteProjectOperation
} from '../types/operations'
import { offlineStore, type DBOperation, type DBItem, type DBTransaction, type DBProject } from './offlineStore'
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
import { refreshProjectSnapshot } from '../utils/realtimeSnapshotUpdater'
import type { QueryClient } from '@tanstack/react-query'
import { removeItemFromCaches, removeTransactionFromCaches } from '@/utils/queryCacheHelpers'

type QueryClientGetter = () => QueryClient

let cachedGetGlobalQueryClient: QueryClientGetter | null = null
function resolveQueryClient(): QueryClient | null {
  try {
    if (!cachedGetGlobalQueryClient) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const queryClientModule = require('../utils/queryClient') as {
        getGlobalQueryClient?: QueryClientGetter
      }
      cachedGetGlobalQueryClient = queryClientModule?.getGlobalQueryClient ?? null
    }

    if (!cachedGetGlobalQueryClient) {
      return null
    }

    return cachedGetGlobalQueryClient()
  } catch {
    return null
  }
}

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
        case 'CREATE_TRANSACTION':
          return (operation as CreateTransactionOperation).data.accountId
        case 'UPDATE_TRANSACTION':
          return (operation as UpdateTransactionOperation).data.accountId
        case 'DELETE_TRANSACTION':
          return (operation as DeleteTransactionOperation).data.accountId
        case 'CREATE_PROJECT':
          return (operation as CreateProjectOperation).data.accountId
        case 'UPDATE_PROJECT':
          return (operation as UpdateProjectOperation).data.accountId
        case 'DELETE_PROJECT':
          return (operation as DeleteProjectOperation).data.accountId
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
        // Mark for retry with exponential backoff
        // Note: Conflict checking is done BEFORE execution (in executeOperation),
        // so we don't need to check again here. If conflicts were blocking,
        // executeOperation would have returned false before attempting execution.
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
      // Conflicts are detected and stored in IndexedDB by conflictDetector
      // The UI (ConflictResolutionView) will load and display them
      const accountId = operation.accountId
      if (accountId) {
        let conflicts: ConflictItem[] = []
        
        // Detect conflicts based on operation type
        if (operation.type.startsWith('CREATE_ITEM') || operation.type.startsWith('UPDATE_ITEM') || operation.type.startsWith('DELETE_ITEM')) {
          const projectId = await this.resolveProjectId(operation)
          if (projectId) {
            conflicts = await conflictDetector.detectConflicts(projectId)
          }
        } else if (operation.type.startsWith('CREATE_TRANSACTION') || operation.type.startsWith('UPDATE_TRANSACTION') || operation.type.startsWith('DELETE_TRANSACTION')) {
          const projectId = await this.resolveProjectId(operation)
          conflicts = await conflictDetector.detectTransactionConflicts(accountId, projectId ?? undefined)
        } else if (operation.type.startsWith('CREATE_PROJECT') || operation.type.startsWith('UPDATE_PROJECT') || operation.type.startsWith('DELETE_PROJECT')) {
          conflicts = await conflictDetector.detectProjectConflicts(accountId)
        }
        
        const targetEntityId = this.getOperationTargetEntityId(operation)
        const relevantConflicts = targetEntityId 
          ? conflicts.filter(conflict => conflict.id === targetEntityId)
          : conflicts
        
        if (this.shouldBlockOperation(operation, conflicts)) {
          console.warn('Conflicts detected for queued operation, delaying execution', {
            operationId: operation.id,
            operationType: operation.type,
            targetEntityId,
            conflictingEntities: relevantConflicts.map(conflict => conflict.id),
            totalConflicts: conflicts.length
          })
          // Conflicts are already stored in IndexedDB by conflictDetector
          // UI will surface them via ConflictResolutionView
          return false
        } else if (conflicts.length > 0 && (operation.type === 'UPDATE_ITEM' || operation.type === 'UPDATE_TRANSACTION' || operation.type === 'UPDATE_PROJECT')) {
          // Log that UPDATE is proceeding despite conflicts (it will resolve them)
          console.log(`${operation.type} proceeding despite conflicts - will resolve on sync`, {
            operationId: operation.id,
            targetEntityId,
            conflictingEntities: relevantConflicts.map(conflict => conflict.id)
          })
        }
      }

      switch (operation.type) {
        case 'CREATE_ITEM':
          return await this.executeCreateItem(operation)
        case 'UPDATE_ITEM':
          return await this.executeUpdateItem(operation)
        case 'DELETE_ITEM':
          return await this.executeDeleteItem(operation)
        case 'CREATE_TRANSACTION':
          return await this.executeCreateTransaction(operation)
        case 'UPDATE_TRANSACTION':
          return await this.executeUpdateTransaction(operation)
        case 'DELETE_TRANSACTION':
          return await this.executeDeleteTransaction(operation)
        case 'CREATE_PROJECT':
          return await this.executeCreateProject(operation)
        case 'UPDATE_PROJECT':
          return await this.executeUpdateProject(operation)
        case 'DELETE_PROJECT':
          return await this.executeDeleteProject(operation)
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
      case 'CREATE_TRANSACTION':
        return (operation as CreateTransactionOperation).data.projectId ?? null
      case 'UPDATE_TRANSACTION':
      case 'DELETE_TRANSACTION':
        // Try to get from local transaction
        return null // Will be resolved via getOperationTargetTransactionId
      default:
        return null
    }
  }

  private async resolveProjectId(operation: Operation): Promise<string | null> {
    const directProjectId = this.getProjectIdFromOperation(operation)
    if (directProjectId !== null) {
      return directProjectId
    }

    // Try to resolve from transaction
    const targetTransactionId = this.getOperationTargetTransactionId(operation)
    if (targetTransactionId) {
      try {
        const localTransaction = await offlineStore.getTransactionById(targetTransactionId)
        return localTransaction?.projectId ?? null
      } catch (error) {
        console.warn('Failed to resolve projectId from transaction for operation', {
          operationId: operation.id,
          targetTransactionId,
          error
        })
      }
    }

    // Try to resolve from item
    const targetItemId = this.getOperationTargetItemId(operation)
    if (targetItemId) {
      try {
        const localItem = await offlineStore.getItemById(targetItemId)
        return localItem?.projectId ?? null
      } catch (error) {
        console.warn('Failed to resolve projectId for operation from offline store', {
          operationId: operation.id,
          targetItemId,
          error
        })
      }
    }

    return null
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
          disposition: localItem.disposition ?? 'purchased',
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
        disposition: serverItem.disposition ?? localItem.disposition ?? 'purchased',
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

  private getOperationTargetEntityId(operation: Operation): string | null {
    switch (operation.type) {
      case 'CREATE_ITEM':
      case 'UPDATE_ITEM':
      case 'DELETE_ITEM':
      case 'CREATE_TRANSACTION':
      case 'UPDATE_TRANSACTION':
      case 'DELETE_TRANSACTION':
      case 'CREATE_PROJECT':
      case 'UPDATE_PROJECT':
      case 'DELETE_PROJECT':
        return operation.data.id
      default:
        return null
    }
  }

  private getOperationTargetTransactionId(operation: Operation): string | null {
    switch (operation.type) {
      case 'CREATE_TRANSACTION':
      case 'UPDATE_TRANSACTION':
      case 'DELETE_TRANSACTION':
        return operation.data.id
      default:
        return null
    }
  }

  private getOperationTargetProjectId(operation: Operation): string | null {
    switch (operation.type) {
      case 'CREATE_PROJECT':
      case 'UPDATE_PROJECT':
      case 'DELETE_PROJECT':
        return operation.data.id
      default:
        return null
    }
  }

  private shouldBlockOperation(operation: Operation, conflicts: ConflictItem[]): boolean {
    if (conflicts.length === 0) {
      return false
    }

    // CREATE operations cannot conflict until after insertion succeeds
    if (operation.type === 'CREATE_ITEM' || operation.type === 'CREATE_TRANSACTION' || operation.type === 'CREATE_PROJECT') {
      return false
    }

    // UPDATE operations should NOT be blocked by conflicts on the target entity
    // because the UPDATE will sync the local state to the server, resolving the conflict
    // Blocking UPDATE operations creates an infinite loop where:
    // 1. Local entity has optimistic updates (different from server)
    // 2. Conflict detection flags this as a conflict
    // 3. UPDATE operation is blocked by the conflict
    // 4. UPDATE can't execute to resolve the conflict → infinite loop
    if (operation.type === 'UPDATE_ITEM' || operation.type === 'UPDATE_TRANSACTION' || operation.type === 'UPDATE_PROJECT') {
      return false
    }

    const targetEntityId = this.getOperationTargetEntityId(operation)
    if (!targetEntityId) {
      return false
    }

    // Only block DELETE operations if there are conflicts (user should resolve conflicts before deleting)
    return conflicts.some(conflict => conflict.id === targetEntityId)
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

      // Clear any conflicts for this item since the UPDATE successfully synced local state to server
      // This resolves conflicts that were detected before the UPDATE executed
      try {
        if (accountId) {
          await offlineStore.deleteConflictsForItems(accountId, [data.id])
          console.log('Cleared conflicts for item after successful UPDATE', { itemId: data.id })
        }
      } catch (conflictClearError) {
        // Non-fatal: log but don't fail the operation
        console.warn('Failed to clear conflicts after UPDATE (non-fatal)', {
          itemId: data.id,
          error: conflictClearError
        })
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
      // Get projectId before deletion for snapshot refresh
      let projectId: string | null = null
      let transactionId: string | null = null
      try {
        const localItem = await offlineStore.getItemById(data.id)
        projectId = localItem?.projectId ?? null
        transactionId = localItem?.transactionId ?? null
      } catch (error) {
        console.warn('Failed to get projectId for item before delete (non-fatal)', {
          itemId: data.id,
          error
        })
      }

      // Delete from server
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('item_id', data.id)

      if (error) throw error

      // Executor must purge + clear conflicts - IndexedDB is always the source of truth
      try {
        await offlineStore.deleteItem(data.id)
        await offlineStore.deleteConflictsForItems(accountId, [data.id])
        if (projectId) {
          refreshProjectSnapshot(projectId)
        }

        // Emit telemetry for conflict + hygiene tracking
        console.info('Item deleted successfully', {
          itemId: data.id,
          accountId,
          projectId,
          operationId: operation.id
        })
      } catch (cleanupError) {
        console.warn('Failed to purge item from offline store after server delete (non-fatal)', {
          itemId: data.id,
          cleanupError
        })
      }

      // Invalidate React Query caches immediately after cleanup
      try {
        const queryClient = this.getQueryClient()
        if (queryClient) {
          removeItemFromCaches(queryClient, accountId, data.id, {
            projectId,
            transactionId
          })
          queryClient.invalidateQueries({ queryKey: ['item', accountId, data.id] })
          if (projectId) {
            queryClient.invalidateQueries({ queryKey: ['project-items', accountId, projectId] })
          } else {
            queryClient.invalidateQueries({ queryKey: ['business-inventory', accountId] })
          }
          if (transactionId) {
            queryClient.invalidateQueries({ queryKey: ['transaction-items', accountId, transactionId] })
          } else {
            queryClient.invalidateQueries({ queryKey: ['transaction-items', accountId] })
          }
        }
      } catch (invalidationError) {
        console.warn('Failed to invalidate React Query after item delete (non-fatal)', {
          itemId: data.id,
          invalidationError
        })
      }

      return true
    } catch (error) {
      console.error('Failed to delete item:', error)
      return false
    }
  }

  private async executeCreateTransaction(operation: CreateTransactionOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full transaction data from local store
      const localTransaction = await offlineStore.getTransactionById(data.id)
      
      if (!localTransaction) {
        console.error(`Cannot create transaction: local transaction ${data.id} not found in offline store`)
        return false
      }

      // Create on server using the FULL transaction data from local store
      // Use fallback '0.00' for sum_item_purchase_prices to prevent NOT NULL constraint violations
      // This is the last line of defense for stale caches (e.g., already-queued entries)
      // Process any offline placeholder URLs in transaction images before creating
      const processedTransaction = await this.processOfflinePlaceholders(localTransaction, accountId)

      const { data: serverTransaction, error } = await supabase
        .from('transactions')
        .insert({
          transaction_id: data.id,
          account_id: accountId,
          project_id: processedTransaction.projectId ?? data.projectId ?? null,
          transaction_date: processedTransaction.transactionDate,
          source: processedTransaction.source ?? '',
          transaction_type: processedTransaction.transactionType ?? '',
          payment_method: processedTransaction.paymentMethod ?? '',
          amount: processedTransaction.amount ?? '0.00',
          budget_category: processedTransaction.budgetCategory ?? null,
          category_id: processedTransaction.categoryId ?? null,
          notes: processedTransaction.notes ?? null,
          transaction_images: processedTransaction.transactionImages ?? null,
          receipt_images: processedTransaction.receiptImages ?? null,
          other_images: processedTransaction.otherImages ?? null,
          receipt_emailed: processedTransaction.receiptEmailed ?? false,
          status: processedTransaction.status ?? null,
          reimbursement_type: processedTransaction.reimbursementType ?? null,
          trigger_event: processedTransaction.triggerEvent ?? null,
          tax_rate_preset: processedTransaction.taxRatePreset ?? null,
          tax_rate_pct: processedTransaction.taxRatePct ?? null,
          subtotal: processedTransaction.subtotal ?? null,
          needs_review: processedTransaction.needsReview ?? null,
          sum_item_purchase_prices: processedTransaction.sumItemPurchasePrices ?? '0.00',
          item_ids: processedTransaction.itemIds ?? null,
          created_at: processedTransaction.createdAt || new Date().toISOString(),
          created_by: processedTransaction.createdBy || updatedBy,
          version: version
        })
        .select()
        .single()

      if (error) throw error

      // Update local store with server response
      const cachedAt = new Date().toISOString()
      const dbTransaction: DBTransaction = {
        transactionId: serverTransaction.transaction_id || data.id,
        accountId,
        projectId: serverTransaction.project_id ?? localTransaction.projectId ?? null,
        projectName: localTransaction.projectName ?? null,
        transactionDate: serverTransaction.transaction_date ?? localTransaction.transactionDate,
        source: serverTransaction.source ?? localTransaction.source ?? '',
        transactionType: serverTransaction.transaction_type ?? localTransaction.transactionType ?? '',
        paymentMethod: serverTransaction.payment_method ?? localTransaction.paymentMethod ?? '',
        amount: serverTransaction.amount ?? localTransaction.amount ?? '0.00',
        budgetCategory: serverTransaction.budget_category ?? localTransaction.budgetCategory,
        categoryId: serverTransaction.category_id ?? localTransaction.categoryId,
        notes: serverTransaction.notes ?? localTransaction.notes,
        receiptEmailed: serverTransaction.receipt_emailed ?? localTransaction.receiptEmailed ?? false,
        createdAt: serverTransaction.created_at ?? localTransaction.createdAt ?? cachedAt,
        createdBy: serverTransaction.created_by ?? localTransaction.createdBy ?? updatedBy,
        status: serverTransaction.status ?? localTransaction.status,
        reimbursementType: serverTransaction.reimbursement_type ?? localTransaction.reimbursementType,
        triggerEvent: serverTransaction.trigger_event ?? localTransaction.triggerEvent,
        taxRatePreset: serverTransaction.tax_rate_preset ?? localTransaction.taxRatePreset,
        taxRatePct: serverTransaction.tax_rate_pct ?? localTransaction.taxRatePct,
        subtotal: serverTransaction.subtotal ?? localTransaction.subtotal,
        needsReview: serverTransaction.needs_review ?? localTransaction.needsReview,
        sumItemPurchasePrices: serverTransaction.sum_item_purchase_prices ?? localTransaction.sumItemPurchasePrices,
        itemIds: serverTransaction.item_ids ?? localTransaction.itemIds,
        version: version,
        last_synced_at: cachedAt
      }
      await offlineStore.saveTransactions([dbTransaction])

      // Refresh project snapshot after successful sync
      const projectId = dbTransaction.projectId
      if (projectId) {
        refreshProjectSnapshot(projectId)
      }

      return true
    } catch (error) {
      console.error('Failed to create transaction on server:', error)
      return false
    }
  }

  private async executeUpdateTransaction(operation: UpdateTransactionOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full transaction data from local store
      const localTransaction = await offlineStore.getTransactionById(data.id)

      if (!localTransaction) {
        console.error(`Cannot update transaction: local transaction ${data.id} not found in offline store`)
        return false
      }

      // Process any offline placeholder URLs in the transaction images before syncing
      const processedTransaction = await this.processOfflinePlaceholders(localTransaction, accountId)

      // Use the processed transaction for the update
      const updatedLocalTransaction: DBTransaction = {
        ...processedTransaction,
        ...(data.updates.amount !== undefined && { amount: data.updates.amount }),
        ...(data.updates.categoryId !== undefined && { categoryId: data.updates.categoryId }),
        ...(data.updates.taxRatePreset !== undefined && { taxRatePreset: data.updates.taxRatePreset }),
        ...(data.updates.status !== undefined && { status: data.updates.status as 'pending' | 'completed' | 'canceled' }),
        version: version
      }

      // Update on server using the FULL transaction data from local store
      const { data: serverTransaction, error } = await supabase
        .from('transactions')
        .update({
          project_id: updatedLocalTransaction.projectId ?? null,
          transaction_date: updatedLocalTransaction.transactionDate,
          source: updatedLocalTransaction.source ?? '',
          transaction_type: updatedLocalTransaction.transactionType ?? '',
          payment_method: updatedLocalTransaction.paymentMethod ?? '',
          amount: updatedLocalTransaction.amount ?? '0.00',
          budget_category: updatedLocalTransaction.budgetCategory ?? null,
          category_id: updatedLocalTransaction.categoryId ?? null,
          notes: updatedLocalTransaction.notes ?? null,
          transaction_images: updatedLocalTransaction.transactionImages ?? null,
          receipt_images: updatedLocalTransaction.receiptImages ?? null,
          other_images: updatedLocalTransaction.otherImages ?? null,
          receipt_emailed: updatedLocalTransaction.receiptEmailed ?? false,
          status: updatedLocalTransaction.status ?? null,
          reimbursement_type: updatedLocalTransaction.reimbursementType ?? null,
          trigger_event: updatedLocalTransaction.triggerEvent ?? null,
          tax_rate_preset: updatedLocalTransaction.taxRatePreset ?? null,
          tax_rate_pct: updatedLocalTransaction.taxRatePct ?? null,
          subtotal: updatedLocalTransaction.subtotal ?? null,
          needs_review: updatedLocalTransaction.needsReview ?? null,
          sum_item_purchase_prices: updatedLocalTransaction.sumItemPurchasePrices ?? null,
          item_ids: updatedLocalTransaction.itemIds ?? null,
          version: version
        })
        .eq('transaction_id', data.id)
        .select()
        .single()

      if (error) throw error

      // Update local store with server response
      const cachedAt = new Date().toISOString()
      const dbTransaction: DBTransaction = {
        transactionId: serverTransaction.transaction_id || data.id,
        accountId,
        projectId: serverTransaction.project_id ?? updatedLocalTransaction.projectId ?? null,
        projectName: updatedLocalTransaction.projectName ?? localTransaction.projectName ?? null,
        transactionDate: serverTransaction.transaction_date ?? updatedLocalTransaction.transactionDate,
        source: serverTransaction.source ?? updatedLocalTransaction.source ?? '',
        transactionType: serverTransaction.transaction_type ?? updatedLocalTransaction.transactionType ?? '',
        paymentMethod: serverTransaction.payment_method ?? updatedLocalTransaction.paymentMethod ?? '',
        amount: serverTransaction.amount ?? updatedLocalTransaction.amount ?? '0.00',
        budgetCategory: serverTransaction.budget_category ?? updatedLocalTransaction.budgetCategory,
        categoryId: serverTransaction.category_id ?? updatedLocalTransaction.categoryId,
        notes: serverTransaction.notes ?? updatedLocalTransaction.notes,
        transactionImages: serverTransaction.transaction_images ?? updatedLocalTransaction.transactionImages,
        receiptImages: serverTransaction.receipt_images ?? updatedLocalTransaction.receiptImages,
        otherImages: serverTransaction.other_images ?? updatedLocalTransaction.otherImages,
        receiptEmailed: serverTransaction.receipt_emailed ?? updatedLocalTransaction.receiptEmailed ?? false,
        createdAt: serverTransaction.created_at ?? updatedLocalTransaction.createdAt ?? cachedAt,
        createdBy: serverTransaction.created_by ?? updatedLocalTransaction.createdBy ?? updatedBy,
        status: serverTransaction.status ?? updatedLocalTransaction.status,
        reimbursementType: serverTransaction.reimbursement_type ?? updatedLocalTransaction.reimbursementType,
        triggerEvent: serverTransaction.trigger_event ?? updatedLocalTransaction.triggerEvent,
        taxRatePreset: serverTransaction.tax_rate_preset ?? updatedLocalTransaction.taxRatePreset,
        taxRatePct: serverTransaction.tax_rate_pct ?? updatedLocalTransaction.taxRatePct,
        subtotal: serverTransaction.subtotal ?? updatedLocalTransaction.subtotal,
        needsReview: serverTransaction.needs_review ?? updatedLocalTransaction.needsReview,
        sumItemPurchasePrices: serverTransaction.sum_item_purchase_prices ?? updatedLocalTransaction.sumItemPurchasePrices,
        itemIds: serverTransaction.item_ids ?? updatedLocalTransaction.itemIds,
        version: version,
        last_synced_at: cachedAt
      }
      await offlineStore.saveTransactions([dbTransaction])

      // Clear any conflicts for this transaction
      try {
        if (accountId) {
          await offlineStore.deleteConflictsForTransactions(accountId, [data.id])
          console.log('Cleared conflicts for transaction after successful UPDATE', { transactionId: data.id })
        }
      } catch (conflictClearError) {
        console.warn('Failed to clear conflicts after UPDATE (non-fatal)', {
          transactionId: data.id,
          error: conflictClearError
        })
      }

      // Refresh project snapshot after successful sync
      const projectId = dbTransaction.projectId
      if (projectId) {
        refreshProjectSnapshot(projectId)
      }

      return true
    } catch (error) {
      console.error('Failed to update transaction:', error)
      return false
    }
  }

  private async executeDeleteTransaction(operation: DeleteTransactionOperation): Promise<boolean> {
    const { data, accountId } = operation

    try {
      // Get projectId before deletion for snapshot refresh
      let projectId: string | null = null
      try {
        const localTransaction = await offlineStore.getTransactionById(data.id)
        projectId = localTransaction?.projectId ?? null
      } catch (error) {
        console.warn('Failed to get projectId for transaction before delete (non-fatal)', {
          transactionId: data.id,
          error
        })
      }

      // Delete from server
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('transaction_id', data.id)

      if (error) throw error

      try {
        await offlineStore.deleteTransaction(data.id)
        if (accountId) {
          await offlineStore.deleteConflictsForTransactions(accountId, [data.id])
        }
        console.info('Transaction deleted successfully', {
          transactionId: data.id,
          accountId,
          projectId,
          operationId: operation.id
        })
      } catch (cleanupError) {
        console.warn('Failed to purge transaction from offline store after server delete (non-fatal)', {
          transactionId: data.id,
          cleanupError
        })
      }

      // Refresh project snapshot after successful sync
      if (projectId) {
        refreshProjectSnapshot(projectId)
      }

      // Invalidate React Query caches immediately after cleanup
      try {
        const queryClient = this.getQueryClient()
        if (queryClient) {
          removeTransactionFromCaches(queryClient, accountId, data.id, projectId)
          queryClient.invalidateQueries({ queryKey: ['transaction', accountId, data.id] })
          if (projectId) {
            queryClient.invalidateQueries({ queryKey: ['project-transactions', accountId, projectId] })
          }
          queryClient.invalidateQueries({ queryKey: ['transaction-items', accountId, data.id] })
          queryClient.invalidateQueries({ queryKey: ['transactions', accountId] })
        }
      } catch (invalidationError) {
        console.warn('Failed to invalidate React Query after transaction delete (non-fatal)', {
          transactionId: data.id,
          invalidationError
        })
      }

      return true
    } catch (error) {
      console.error('Failed to delete transaction:', error)
      return false
    }
  }

  private async executeCreateProject(operation: CreateProjectOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full project data from local store
      const localProject = await offlineStore.getProjectById(data.id)
      
      if (!localProject) {
        console.error(`Cannot create project: local project ${data.id} not found in offline store`)
        return false
      }

      // Create on server using the FULL project data from local store
      const { data: serverProject, error } = await supabase
        .from('projects')
        .insert({
          id: data.id,
          account_id: accountId,
          name: localProject.name,
          description: localProject.description ?? '',
          client_name: localProject.clientName ?? '',
          budget: localProject.budget ?? null,
          design_fee: localProject.designFee ?? null,
          budget_categories: localProject.budgetCategories ?? {},
          default_category_id: localProject.defaultCategoryId ?? null,
          main_image_url: localProject.mainImageUrl ?? null,
          settings: localProject.settings ?? {},
          metadata: localProject.metadata ?? {},
          item_count: localProject.itemCount ?? 0,
          transaction_count: localProject.transactionCount ?? 0,
          total_value: localProject.totalValue ?? 0,
          created_at: localProject.createdAt || new Date().toISOString(),
          updated_at: localProject.updatedAt || new Date().toISOString(),
          created_by: localProject.createdBy || updatedBy,
          version: version
        })
        .select()
        .single()

      if (error) throw error

      // Update local store with server response
      const cachedAt = new Date().toISOString()
      const dbProject: DBProject = {
        id: serverProject.id || data.id,
        accountId: accountId || localProject.accountId,
        name: serverProject.name ?? localProject.name,
        description: serverProject.description ?? localProject.description ?? '',
        clientName: serverProject.client_name ?? localProject.clientName ?? '',
        budget: serverProject.budget ?? localProject.budget,
        designFee: serverProject.design_fee ?? localProject.designFee,
        budgetCategories: serverProject.budget_categories ?? localProject.budgetCategories,
        defaultCategoryId: serverProject.default_category_id ?? localProject.defaultCategoryId,
        mainImageUrl: serverProject.main_image_url ?? localProject.mainImageUrl,
        settings: serverProject.settings ?? localProject.settings,
        metadata: serverProject.metadata ?? localProject.metadata,
        itemCount: serverProject.item_count ?? localProject.itemCount,
        transactionCount: serverProject.transaction_count ?? localProject.transactionCount,
        totalValue: serverProject.total_value ?? localProject.totalValue,
        createdAt: serverProject.created_at ?? localProject.createdAt ?? cachedAt,
        updatedAt: serverProject.updated_at ?? localProject.updatedAt ?? cachedAt,
        createdBy: serverProject.created_by ?? localProject.createdBy ?? updatedBy,
        version: version,
        last_synced_at: cachedAt
      }
      await offlineStore.saveProjects([dbProject])

      return true
    } catch (error) {
      console.error('Failed to create project on server:', error)
      return false
    }
  }

  private async executeUpdateProject(operation: UpdateProjectOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full project data from local store
      const localProject = await offlineStore.getProjectById(data.id)
      
      if (!localProject) {
        console.error(`Cannot update project: local project ${data.id} not found in offline store`)
        return false
      }

      // Merge the operation updates into the full local project
      const updatedLocalProject: DBProject = {
        ...localProject,
        ...(data.updates.name !== undefined && { name: data.updates.name }),
        ...(data.updates.budget !== undefined && { budget: data.updates.budget }),
        ...(data.updates.description !== undefined && { description: data.updates.description ?? '' }),
        ...(data.updates.clientName !== undefined && { clientName: data.updates.clientName ?? '' }),
        ...(data.updates.designFee !== undefined && { designFee: data.updates.designFee }),
        ...(data.updates.budgetCategories !== undefined && {
          budgetCategories: data.updates.budgetCategories ?? {}
        }),
        ...(data.updates.defaultCategoryId !== undefined && {
          defaultCategoryId: data.updates.defaultCategoryId ?? null
        }),
        ...(data.updates.mainImageUrl !== undefined && { mainImageUrl: data.updates.mainImageUrl ?? null }),
        ...(data.updates.settings !== undefined && { settings: data.updates.settings ?? {} }),
        ...(data.updates.metadata !== undefined && { metadata: data.updates.metadata ?? {} }),
        ...(data.updates.itemCount !== undefined && { itemCount: data.updates.itemCount }),
        ...(data.updates.transactionCount !== undefined && { transactionCount: data.updates.transactionCount }),
        ...(data.updates.totalValue !== undefined && { totalValue: data.updates.totalValue }),
        updatedAt: new Date().toISOString(),
        version: version
      }

      // Update on server using the FULL project data from local store
      const { data: serverProject, error } = await supabase
        .from('projects')
        .update({
          name: updatedLocalProject.name,
          description: updatedLocalProject.description ?? '',
          client_name: updatedLocalProject.clientName ?? '',
          budget: updatedLocalProject.budget ?? null,
          design_fee: updatedLocalProject.designFee ?? null,
          budget_categories: updatedLocalProject.budgetCategories ?? {},
          default_category_id: updatedLocalProject.defaultCategoryId ?? null,
          main_image_url: updatedLocalProject.mainImageUrl ?? null,
          settings: updatedLocalProject.settings ?? {},
          metadata: updatedLocalProject.metadata ?? {},
          item_count: updatedLocalProject.itemCount ?? 0,
          transaction_count: updatedLocalProject.transactionCount ?? 0,
          total_value: updatedLocalProject.totalValue ?? 0,
          updated_at: updatedLocalProject.updatedAt || new Date().toISOString(),
          version: version
        })
        .eq('id', data.id)
        .select()
        .single()

      if (error) throw error

      // Update local store with server response
      const cachedAt = new Date().toISOString()
      const dbProject: DBProject = {
        id: serverProject.id || data.id,
        accountId: accountId || updatedLocalProject.accountId,
        name: serverProject.name ?? updatedLocalProject.name,
        description: serverProject.description ?? updatedLocalProject.description ?? '',
        clientName: serverProject.client_name ?? updatedLocalProject.clientName ?? '',
        budget: serverProject.budget ?? updatedLocalProject.budget,
        designFee: serverProject.design_fee ?? updatedLocalProject.designFee,
        budgetCategories: serverProject.budget_categories ?? updatedLocalProject.budgetCategories,
        defaultCategoryId: serverProject.default_category_id ?? updatedLocalProject.defaultCategoryId,
        mainImageUrl: serverProject.main_image_url ?? updatedLocalProject.mainImageUrl,
        settings: serverProject.settings ?? updatedLocalProject.settings,
        metadata: serverProject.metadata ?? updatedLocalProject.metadata,
        itemCount: serverProject.item_count ?? updatedLocalProject.itemCount,
        transactionCount: serverProject.transaction_count ?? updatedLocalProject.transactionCount,
        totalValue: serverProject.total_value ?? updatedLocalProject.totalValue,
        createdAt: serverProject.created_at ?? updatedLocalProject.createdAt ?? cachedAt,
        updatedAt: serverProject.updated_at ?? updatedLocalProject.updatedAt ?? cachedAt,
        createdBy: serverProject.created_by ?? updatedLocalProject.createdBy ?? updatedBy,
        version: version,
        last_synced_at: cachedAt
      }
      await offlineStore.saveProjects([dbProject])

      // Clear any conflicts for this project
      try {
        if (accountId) {
          await offlineStore.deleteConflictsForProjects(accountId, [data.id])
          console.log('Cleared conflicts for project after successful UPDATE', { projectId: data.id })
        }
      } catch (conflictClearError) {
        console.warn('Failed to clear conflicts after UPDATE (non-fatal)', {
          projectId: data.id,
          error: conflictClearError
        })
      }

      return true
    } catch (error) {
      console.error('Failed to update project:', error)
      return false
    }
  }

  private async executeDeleteProject(operation: DeleteProjectOperation): Promise<boolean> {
    const { data, accountId } = operation

    try {
      // Delete from server
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', data.id)

      if (error) throw error

      try {
        await offlineStore.deleteProject(data.id)
        if (accountId) {
          await offlineStore.deleteConflictsForProjects(accountId, [data.id])
        }
      } catch (cleanupError) {
        console.warn('Failed to purge project from offline store after server delete (non-fatal)', {
          projectId: data.id,
          cleanupError
        })
      }

      return true
    } catch (error) {
      console.error('Failed to delete project:', error)
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

  async getEntityIdsWithPendingWrites(
    entityType: 'item' | 'transaction' | 'project'
  ): Promise<Set<string>> {
    await this.init()

    const pendingIds = new Set<string>()
    const writeTypes = this.getWriteOperationTypes(entityType)

    if (writeTypes.length === 0) {
      return pendingIds
    }

    for (const operation of this.queue) {
      if (!writeTypes.includes(operation.type)) {
        continue
      }
      const entityId = this.extractEntityId(operation)
      if (entityId) {
        pendingIds.add(entityId)
      }
    }

    return pendingIds
  }

  async removeOperation(operationId: string): Promise<boolean> {
    await this.init()

    const index = this.queue.findIndex(op => op.id === operationId)

    if (index === -1) {
      try {
        await offlineStore.deleteOperation(operationId)
        return true
      } catch (error) {
        console.warn('Failed to delete operation from offline store during removal', {
          operationId,
          error
        })
        return false
      }
    }

    this.queue.splice(index, 1)
    await this.persistQueue()
    this.emitQueueChange()
    return true
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

  private getWriteOperationTypes(entityType: 'item' | 'transaction' | 'project'): Operation['type'][] {
    switch (entityType) {
      case 'item':
        return ['UPDATE_ITEM', 'DELETE_ITEM']
      case 'transaction':
        return ['UPDATE_TRANSACTION', 'DELETE_TRANSACTION']
      case 'project':
        return ['UPDATE_PROJECT', 'DELETE_PROJECT']
      default:
        return []
    }
  }

  private extractEntityId(operation: Operation): string | null {
    switch (operation.type) {
      case 'CREATE_ITEM':
      case 'UPDATE_ITEM':
      case 'DELETE_ITEM':
        return operation.data.id
      case 'CREATE_TRANSACTION':
      case 'UPDATE_TRANSACTION':
      case 'DELETE_TRANSACTION':
        return operation.data.id
      case 'CREATE_PROJECT':
      case 'UPDATE_PROJECT':
      case 'DELETE_PROJECT':
        return operation.data.id
      default:
        return null
    }
  }

  private getQueryClient(): QueryClient | null {
    return resolveQueryClient()
  }

  /**
   * Process offline placeholder URLs in transaction images by uploading them
   */
  private async processOfflinePlaceholders(transaction: DBTransaction, accountId: string): Promise<DBTransaction> {
    const { ImageUploadService } = await import('./imageService')
    const { offlineMediaService } = await import('./offlineMediaService')

    const processImageArray = async (images: any[] | undefined, type: 'receipt' | 'other' | 'transaction'): Promise<any[]> => {
      if (!images || images.length === 0) return images

      const processedImages = []
      const projectNameForStorage =
        (transaction.projectName && transaction.projectName.trim().length > 0)
          ? transaction.projectName
          : transaction.projectId
            ? `Project-${transaction.projectId}`
            : 'Unknown-Project'

      for (const image of images) {
        if (image.url?.startsWith('offline://')) {
          const mediaId = image.url.replace('offline://', '')

          try {
            // Get the media file
            const mediaFile = await offlineMediaService.getMediaFile(mediaId)
            if (!mediaFile) {
              console.warn(`Offline media file ${mediaId} not found, keeping placeholder`)
              processedImages.push(image)
              continue
            }

            // Upload based on type
            let uploadResult

            // Convert blob to File object for upload
            const file = new File([mediaFile.blob], mediaFile.filename, { type: mediaFile.mimeType })

            if (type === 'receipt') {
              uploadResult = await ImageUploadService.uploadReceiptAttachment(
                file,
                projectNameForStorage,
                transaction.transactionId
              )
            } else if (type === 'other') {
              uploadResult = await ImageUploadService.uploadOtherImage(
                file,
                projectNameForStorage,
                transaction.transactionId
              )
            } else {
              uploadResult = await ImageUploadService.uploadTransactionImage(
                file,
                projectNameForStorage,
                transaction.transactionId
              )
            }

            // Replace with uploaded URL
            processedImages.push({
              ...image,
              url: uploadResult.url,
              fileName: uploadResult.fileName,
              size: uploadResult.size,
              mimeType: uploadResult.mimeType,
              metadata: {
                ...image.metadata,
                offlineMediaId: undefined,
                isOfflinePlaceholder: false
              }
            })

            // Clean up offline media
            await offlineMediaService.deleteMediaFile(mediaId)

          } catch (error) {
            console.error(`Failed to upload offline media ${mediaId}:`, error)
            // Keep the placeholder on failure
            processedImages.push(image)
          }
        } else {
          // Not an offline placeholder, keep as-is
          processedImages.push(image)
        }
      }

      return processedImages
    }

    const processedTransaction = { ...transaction }

    if (transaction.receiptImages) {
      processedTransaction.receiptImages = await processImageArray(transaction.receiptImages, 'receipt')
    }

    if (transaction.otherImages) {
      processedTransaction.otherImages = await processImageArray(transaction.otherImages, 'other')
    }

    if (transaction.transactionImages) {
      processedTransaction.transactionImages = await processImageArray(transaction.transactionImages, 'transaction')
    }

    return processedTransaction
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