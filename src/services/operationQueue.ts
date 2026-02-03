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
  DeleteProjectOperation,
  DeallocateItemToBusinessInventoryOperation,
  AllocateItemToProjectOperation,
  SellItemToProjectOperation
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
import { refreshBusinessInventorySnapshot, refreshProjectSnapshot } from '../utils/realtimeSnapshotUpdater'
import type { QueryClient } from '@tanstack/react-query'
import { removeItemFromCaches, removeTransactionFromCaches } from '@/utils/queryCacheHelpers'

type QueryClientGetter = () => QueryClient

let cachedGetGlobalQueryClient: QueryClientGetter | null = null
const MISSING_BUDGET_CATEGORY_ERROR_REGEX = /Category ID .* does not exist in budget categories for account/i
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

const isMissingBudgetCategoryError = (error: any): boolean => {
  if (!error) return false
  const message = typeof error?.message === 'string' ? error.message : ''
  const details = typeof error?.details === 'string' ? error.details : ''
  return MISSING_BUDGET_CATEGORY_ERROR_REGEX.test(message) || MISSING_BUDGET_CATEGORY_ERROR_REGEX.test(details)
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

export class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
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
        syncStatus: op.syncStatus,
        interventionReason: op.interventionReason,
        pausedAt: op.pausedAt,
        errorCode: op.errorCode,
        errorDetails: op.errorDetails,
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

      const runnableIndex = this.queue.findIndex(op => !this.isOperationPaused(op))
      if (runnableIndex === -1) {
        // All remaining operations require manual intervention. Do not hammer the server.
        this.isProcessing = false
        return
      }

      const operation = this.queue[runnableIndex]

      // Validate that the current user matches the operation's updatedBy
      // This ensures offline-queued operations can only be processed by the user who created them
      if (operation.updatedBy !== currentUser.id) {
        const message = `Operation ${operation.id} was queued by user ${operation.updatedBy} but current user is ${currentUser.id}.`
        console.warn(`${message} Keeping it queued until the original user signs in.`)
        operation.lastError = 'Queued by a different user; cannot sync until they sign in.'
        this.lastEnqueueError = operation.lastError
        await this.persistQueue()
        this.emitQueueChange()
        this.isProcessing = false
        return
      }

      const success = await this.executeOperation(operation)

      if (success) {
        this.queue.splice(runnableIndex, 1) // Remove completed operation
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
        // If the executor marked the operation as paused (requires intervention),
        // persist it and continue processing other queued work.
        if (this.isOperationPaused(operation)) {
          await this.persistQueue()
          this.emitQueueChange()
          setTimeout(() => this.processQueue(), 100)
          return
        }

        // Mark for retry with exponential backoff
        // Note: Conflict checking is done BEFORE execution (in executeOperation),
        // so we don't need to check again here. If conflicts were blocking,
        // executeOperation would have returned false before attempting execution.
        operation.retryCount++
        operation.lastError = operation.lastError ?? 'Sync failed'

        if (operation.retryCount >= 5) {
          const message = `Operation ${operation.id} has failed ${operation.retryCount} times. Keeping it queued for retry.`
          console.error(message, operation)
          this.lastEnqueueError = message
        }

        // Schedule retry
        const delay = Math.min(1000 * Math.pow(2, operation.retryCount), 30000)
        setTimeout(() => this.processQueue(), delay)

        await this.persistQueue()
        this.emitQueueChange()
      }
    } catch (error) {
      if (error instanceof FatalError) {
        console.error(`Operation ${this.queue[0]?.id} failed with fatal error, removing from queue:`, error.message)
        this.queue.shift()
        await this.persistQueue()
        this.emitQueueChange()
        setTimeout(() => this.processQueue(), 100)
      } else {
        console.error('Error processing queue:', error)
      }
    } finally {
      this.isProcessing = false
    }
  }

  private isOperationPaused(operation: Operation): boolean {
    return (operation as any).syncStatus === 'requires_intervention'
  }

  private unpauseMissingItemOperationsForItem(itemId: string): void {
    if (!itemId) return
    let changed = false

    for (const op of this.queue) {
      if (op.type !== 'UPDATE_ITEM') continue
      if (op.data.id !== itemId) continue
      if ((op as any).syncStatus !== 'requires_intervention') continue
      if ((op as any).interventionReason !== 'missing_item_on_server') continue

      ;(op as any).syncStatus = 'pending'
      ;(op as any).interventionReason = undefined
      ;(op as any).pausedAt = undefined
      ;(op as any).errorCode = undefined
      ;(op as any).errorDetails = undefined
      op.lastError = undefined
      op.retryCount = 0
      changed = true
    }

    if (changed) {
      this.emitQueueChange()
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
        if (
          operation.type.startsWith('CREATE_ITEM') ||
          operation.type.startsWith('UPDATE_ITEM') ||
          operation.type.startsWith('DELETE_ITEM') ||
          operation.type === 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY' ||
          operation.type === 'ALLOCATE_ITEM_TO_PROJECT' ||
          operation.type === 'SELL_ITEM_TO_PROJECT'
        ) {
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
        case 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY':
          return await this.executeDeallocateItemToBusinessInventory(operation)
        case 'ALLOCATE_ITEM_TO_PROJECT':
          return await this.executeAllocateItemToProject(operation)
        case 'SELL_ITEM_TO_PROJECT':
          return await this.executeSellItemToProject(operation)
        default: {
          const opType = (operation as any)?.type
          console.error('Unknown operation type:', opType)
          return false
        }
      }
    } catch (error) {
      if (error instanceof FatalError) throw error
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
      case 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY':
        return (operation as DeallocateItemToBusinessInventoryOperation).data.projectId
      case 'ALLOCATE_ITEM_TO_PROJECT':
        return (operation as AllocateItemToProjectOperation).data.projectId
      case 'SELL_ITEM_TO_PROJECT':
        return (operation as SellItemToProjectOperation).data.targetProjectId
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
        const message = `Cannot create item: local item ${data.id} not found in offline store`
        console.error(message)
        throw new FatalError(message)
      }

      // Create on server using the FULL item data from local store, not just operation data
      // This ensures source, sku, paymentMethod, qrKey, etc. match what user entered
      const { data: serverItem, error } = await supabase
        .from('items')
        .upsert({
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
        }, { onConflict: 'item_id' })
        // Make CREATE idempotent (helps recreate + retries).
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

      // If the user chose "Recreate" from Sync Issues, there may be paused UPDATE_ITEM ops
      // for this item. Now that CREATE succeeded, unpause them so the rest of the queue can proceed.
      this.unpauseMissingItemOperationsForItem(data.id)

      return true
    } catch (error: any) {
      if (error?.code === 'P0001' || error?.code === '23503' || error?.code === '42501' || error?.status === 400) {
        console.error('Fatal error creating item:', error)
        throw new FatalError(error.message || 'Fatal error creating item')
      }
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
      case 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY':
        return (operation as DeallocateItemToBusinessInventoryOperation).data.itemId
      case 'ALLOCATE_ITEM_TO_PROJECT':
        return (operation as AllocateItemToProjectOperation).data.itemId
      case 'SELL_ITEM_TO_PROJECT':
        return (operation as SellItemToProjectOperation).data.itemId
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
      case 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY':
        return (operation as DeallocateItemToBusinessInventoryOperation).data.itemId
      case 'ALLOCATE_ITEM_TO_PROJECT':
        return (operation as AllocateItemToProjectOperation).data.itemId
      case 'SELL_ITEM_TO_PROJECT':
        return (operation as SellItemToProjectOperation).data.itemId
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
    if (
      operation.type === 'UPDATE_ITEM' ||
      operation.type === 'UPDATE_TRANSACTION' ||
      operation.type === 'UPDATE_PROJECT' ||
      operation.type === 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY' ||
      operation.type === 'ALLOCATE_ITEM_TO_PROJECT' ||
      operation.type === 'SELL_ITEM_TO_PROJECT'
    ) {
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
      let localItem = await offlineStore.getItemById(data.id)
      
      if (!localItem) {
        // Try to resurrect from server to prevent data loss
        console.warn(`Local item ${data.id} missing for update, attempting to fetch from server...`)
        const { data: serverItem, error: fetchError } = await supabase
          .from('items')
          .select()
          .eq('item_id', data.id)
          .single()

        if (serverItem && !fetchError) {
          console.info(`Resurrected item ${data.id} from server`)
          const cachedAt = new Date().toISOString()
          // Reconstruct DBItem from server data
          localItem = {
            itemId: serverItem.item_id,
            accountId: serverItem.account_id,
            projectId: serverItem.project_id,
            transactionId: serverItem.transaction_id,
            previousProjectTransactionId: serverItem.previous_project_transaction_id,
            previousProjectId: serverItem.previous_project_id,
            name: serverItem.name,
            description: serverItem.description ?? '',
            source: serverItem.source,
            sku: serverItem.sku,
            paymentMethod: serverItem.payment_method,
            disposition: serverItem.disposition ?? 'purchased',
            notes: serverItem.notes,
            space: serverItem.space,
            qrKey: serverItem.qr_key,
            bookmark: serverItem.bookmark ?? false,
            purchasePrice: serverItem.purchase_price,
            projectPrice: serverItem.project_price,
            marketValue: serverItem.market_value,
            taxRatePct: serverItem.tax_rate_pct,
            taxAmountPurchasePrice: serverItem.tax_amount_purchase_price,
            taxAmountProjectPrice: serverItem.tax_amount_project_price,
            inventoryStatus: serverItem.inventory_status,
            businessInventoryLocation: serverItem.business_inventory_location,
            originTransactionId: serverItem.origin_transaction_id,
            latestTransactionId: serverItem.latest_transaction_id,
            lastUpdated: serverItem.last_updated ?? cachedAt,
            dateCreated: serverItem.date_created ?? cachedAt,
            createdAt: serverItem.created_at ?? cachedAt,
            images: serverItem.images ?? [],
            createdBy: serverItem.created_by,
            version: serverItem.version ?? 1,
            last_synced_at: cachedAt
          }
          await offlineStore.saveItems([localItem])
        } else {
          const message = `Cannot update item: local item ${data.id} not found in offline store and not found on server`
          console.error(message)
          throw new FatalError(message)
        }
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
      let { data: serverItem, error } = await supabase
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

      if (error) {
        // If the update failed because the item is missing on server (PGRST116 / 0 rows),
        // it likely means the item was deleted on the server. Do NOT retry indefinitely,
        // and do NOT auto-skip. Pause and let the user decide (discard vs recreate).
        const zeroRows =
          (typeof error.details === 'string' && error.details.includes('0 rows')) ||
          (typeof error.message === 'string' && error.message.includes('0 rows'))
        if (error.code === 'PGRST116' || zeroRows) {
          ;(operation as any).syncStatus = 'requires_intervention'
          ;(operation as any).interventionReason = 'missing_item_on_server'
          ;(operation as any).pausedAt = new Date().toISOString()
          ;(operation as any).errorCode = error.code
          ;(operation as any).errorDetails = error.details
          operation.lastError = 'Item not found on server (likely deleted). Action required.'
          console.warn(
            `[operationQueue] UPDATE_ITEM paused: item missing on server (requires intervention)`,
            { operationId: operation.id, itemId: data.id }
          )
          return false
        }
        
        throw error
      }

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
    } catch (error: any) {
      if (error?.code === 'P0001' || error?.code === '23503' || error?.code === '42501' || error?.status === 400) {
        console.error('Fatal error updating item:', error)
        throw new FatalError(error.message || 'Fatal error updating item')
      }
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
        const message = `Cannot create transaction: local transaction ${data.id} not found in offline store`
        console.error(message)
        throw new FatalError(message)
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
    } catch (error: any) {
      if (error?.code === 'P0001' || error?.code === '23503' || error?.code === '42501' || error?.status === 400) {
        console.error('Fatal error creating transaction:', error)
        throw new FatalError(error.message || 'Fatal error creating transaction')
      }
      console.error('Failed to create transaction on server:', error)
      return false
    }
  }

  private async executeUpdateTransaction(operation: UpdateTransactionOperation): Promise<boolean> {
    const { data, accountId, updatedBy, version } = operation

    try {
      // Get the full transaction data from local store
      let localTransaction = await offlineStore.getTransactionById(data.id)

      if (!localTransaction) {
        // Try to resurrect from server
        console.warn(`Local transaction ${data.id} missing for update, attempting to fetch from server...`)
        const { data: serverTransaction, error: fetchError } = await supabase
          .from('transactions')
          .select()
          .eq('transaction_id', data.id)
          .single()

        if (serverTransaction && !fetchError) {
          console.info(`Resurrected transaction ${data.id} from server`)
          const cachedAt = new Date().toISOString()
          localTransaction = {
            transactionId: serverTransaction.transaction_id,
            accountId: serverTransaction.account_id,
            projectId: serverTransaction.project_id,
            projectName: null, // Will be refreshed
            transactionDate: serverTransaction.transaction_date,
            source: serverTransaction.source ?? '',
            transactionType: serverTransaction.transaction_type ?? '',
            paymentMethod: serverTransaction.payment_method ?? '',
            amount: serverTransaction.amount ?? '0.00',
            budgetCategory: serverTransaction.budget_category,
            categoryId: serverTransaction.category_id,
            notes: serverTransaction.notes,
            transactionImages: serverTransaction.transaction_images,
            receiptImages: serverTransaction.receipt_images,
            otherImages: serverTransaction.other_images,
            receiptEmailed: serverTransaction.receipt_emailed ?? false,
            createdAt: serverTransaction.created_at ?? cachedAt,
            createdBy: serverTransaction.created_by,
            status: serverTransaction.status,
            reimbursementType: serverTransaction.reimbursement_type,
            triggerEvent: serverTransaction.trigger_event,
            taxRatePreset: serverTransaction.tax_rate_preset,
            taxRatePct: serverTransaction.tax_rate_pct,
            subtotal: serverTransaction.subtotal,
            needsReview: serverTransaction.needs_review,
            sumItemPurchasePrices: serverTransaction.sum_item_purchase_prices,
            itemIds: serverTransaction.item_ids,
            version: serverTransaction.version ?? 1,
            last_synced_at: cachedAt
          }
          await offlineStore.saveTransactions([localTransaction])
        } else {
          const message = `Cannot update transaction: local transaction ${data.id} not found in offline store and not found on server`
          console.error(message)
          throw new FatalError(message)
        }
      }

      // Process any offline placeholder URLs in the transaction images before syncing
      const processedTransaction = await this.processOfflinePlaceholders(localTransaction, accountId)

      // Use the processed transaction for the update
      const updatedLocalTransaction: DBTransaction = {
        ...processedTransaction,
        ...(data.updates.amount !== undefined && { amount: data.updates.amount }),
        ...(data.updates.categoryId !== undefined && { categoryId: data.updates.categoryId }),
        ...(data.updates.taxRatePct !== undefined && { taxRatePct: data.updates.taxRatePct }),
        ...(data.updates.subtotal !== undefined && { subtotal: data.updates.subtotal }),
        ...(data.updates.taxRatePreset !== undefined && { taxRatePreset: data.updates.taxRatePreset }),
        ...(data.updates.status !== undefined && { status: data.updates.status as 'pending' | 'completed' | 'canceled' }),
        version: version
      }

      const attemptUpdate = async (transactionSnapshot: DBTransaction): Promise<{ success: boolean; error?: any }> => {
        const { data: serverTransaction, error } = await supabase
          .from('transactions')
          .update({
            project_id: transactionSnapshot.projectId ?? null,
            transaction_date: transactionSnapshot.transactionDate,
            source: transactionSnapshot.source ?? '',
            transaction_type: transactionSnapshot.transactionType ?? '',
            payment_method: transactionSnapshot.paymentMethod ?? '',
            amount: transactionSnapshot.amount ?? '0.00',
            budget_category: transactionSnapshot.budgetCategory ?? null,
            category_id: transactionSnapshot.categoryId ?? null,
            notes: transactionSnapshot.notes ?? null,
            transaction_images: transactionSnapshot.transactionImages ?? null,
            receipt_images: transactionSnapshot.receiptImages ?? null,
            other_images: transactionSnapshot.otherImages ?? null,
            receipt_emailed: transactionSnapshot.receiptEmailed ?? false,
            status: transactionSnapshot.status ?? null,
            reimbursement_type: transactionSnapshot.reimbursementType ?? null,
            trigger_event: transactionSnapshot.triggerEvent ?? null,
            tax_rate_preset: transactionSnapshot.taxRatePreset ?? null,
            tax_rate_pct: transactionSnapshot.taxRatePct ?? null,
            subtotal: transactionSnapshot.subtotal ?? null,
            needs_review: transactionSnapshot.needsReview ?? null,
            sum_item_purchase_prices: transactionSnapshot.sumItemPurchasePrices ?? null,
            item_ids: transactionSnapshot.itemIds ?? null,
            version: version
          })
          .eq('transaction_id', data.id)
          .select()
          .single()

        if (error) return { success: false, error }

        // Update local store with server response
        const cachedAt = new Date().toISOString()
        const dbTransaction: DBTransaction = {
          transactionId: serverTransaction.transaction_id || data.id,
          accountId,
          projectId: serverTransaction.project_id ?? transactionSnapshot.projectId ?? null,
          projectName: transactionSnapshot.projectName ?? localTransaction.projectName ?? null,
          transactionDate: serverTransaction.transaction_date ?? transactionSnapshot.transactionDate,
          source: serverTransaction.source ?? transactionSnapshot.source ?? '',
          transactionType: serverTransaction.transaction_type ?? transactionSnapshot.transactionType ?? '',
          paymentMethod: serverTransaction.payment_method ?? transactionSnapshot.paymentMethod ?? '',
          amount: serverTransaction.amount ?? transactionSnapshot.amount ?? '0.00',
          budgetCategory: serverTransaction.budget_category ?? transactionSnapshot.budgetCategory,
          categoryId: serverTransaction.category_id ?? transactionSnapshot.categoryId,
          notes: serverTransaction.notes ?? transactionSnapshot.notes,
          transactionImages: serverTransaction.transaction_images ?? transactionSnapshot.transactionImages,
          receiptImages: serverTransaction.receipt_images ?? transactionSnapshot.receiptImages,
          otherImages: serverTransaction.other_images ?? transactionSnapshot.otherImages,
          receiptEmailed: serverTransaction.receipt_emailed ?? transactionSnapshot.receiptEmailed ?? false,
          createdAt: serverTransaction.created_at ?? transactionSnapshot.createdAt ?? cachedAt,
          createdBy: serverTransaction.created_by ?? transactionSnapshot.createdBy ?? updatedBy,
          status: serverTransaction.status ?? transactionSnapshot.status,
          reimbursementType: serverTransaction.reimbursement_type ?? transactionSnapshot.reimbursementType,
          triggerEvent: serverTransaction.trigger_event ?? transactionSnapshot.triggerEvent,
          taxRatePreset: serverTransaction.tax_rate_preset ?? transactionSnapshot.taxRatePreset,
          taxRatePct: serverTransaction.tax_rate_pct ?? transactionSnapshot.taxRatePct,
          subtotal: serverTransaction.subtotal ?? transactionSnapshot.subtotal,
          needsReview: serverTransaction.needs_review ?? transactionSnapshot.needsReview,
          sumItemPurchasePrices: serverTransaction.sum_item_purchase_prices ?? transactionSnapshot.sumItemPurchasePrices,
          itemIds: serverTransaction.item_ids ?? transactionSnapshot.itemIds,
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

        return { success: true }
      }

      const firstAttempt = await attemptUpdate(updatedLocalTransaction)
      if (firstAttempt.success) {
        return true
      }

      if (isMissingBudgetCategoryError(firstAttempt.error)) {
        const repairedTransaction: DBTransaction = {
          ...updatedLocalTransaction,
          categoryId: null,
          budgetCategory: null
        }
        try {
          await offlineStore.init()
          await offlineStore.upsertTransaction(repairedTransaction)
        } catch (repairError) {
          console.warn('Failed to clear local transaction category after invalid category error:', repairError)
        }

        const retryAttempt = await attemptUpdate(repairedTransaction)
        if (retryAttempt.success) {
          return true
        }
        throw retryAttempt.error
      }

      throw firstAttempt.error
    } catch (error: any) {
      // P0001: Raise Exception (custom validation)
      // 23503: Foreign Key Violation
      // 42501: RLS/Permission Denied
      // 400: Bad Request (validation error)
      if (error?.code === 'P0001' || error?.code === '23503' || error?.code === '42501' || error?.status === 400) {
        console.error('Fatal error updating transaction:', error)
        throw new FatalError(error.message || 'Fatal error updating transaction')
      }
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
      let localProject = await offlineStore.getProjectById(data.id)
      
      if (!localProject) {
        // Try to resurrect from server
        console.warn(`Local project ${data.id} missing for update, attempting to fetch from server...`)
        const { data: serverProject, error: fetchError } = await supabase
          .from('projects')
          .select()
          .eq('id', data.id)
          .single()

        if (serverProject && !fetchError) {
          console.info(`Resurrected project ${data.id} from server`)
          const cachedAt = new Date().toISOString()
          localProject = {
            id: serverProject.id,
            accountId: serverProject.account_id,
            name: serverProject.name,
            description: serverProject.description ?? '',
            clientName: serverProject.client_name ?? '',
            budget: serverProject.budget,
            designFee: serverProject.design_fee,
            budgetCategories: serverProject.budget_categories ?? {},
            defaultCategoryId: serverProject.default_category_id,
            mainImageUrl: serverProject.main_image_url,
            settings: serverProject.settings ?? {},
            metadata: serverProject.metadata ?? {},
            itemCount: serverProject.item_count ?? 0,
            transactionCount: serverProject.transaction_count ?? 0,
            totalValue: serverProject.total_value ?? 0,
            createdAt: serverProject.created_at ?? cachedAt,
            updatedAt: serverProject.updated_at ?? cachedAt,
            createdBy: serverProject.created_by,
            version: serverProject.version ?? 1,
            last_synced_at: cachedAt
          }
          await offlineStore.saveProjects([localProject])
        } else {
          const message = `Cannot update project: local project ${data.id} not found in offline store and not found on server`
          console.error(message)
          throw new FatalError(message)
        }
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

  private async executeDeallocateItemToBusinessInventory(
    operation: DeallocateItemToBusinessInventoryOperation
  ): Promise<boolean> {
    const { accountId } = operation
    const { itemId, projectId, disposition } = operation.data

    try {
      const { deallocationService } = await import('./inventoryService')
      await deallocationService.handleInventoryDesignation(accountId, itemId, projectId, disposition)
      await this.verifyCanonicalInvariants(operation)
      return true
    } catch (error) {
      console.error('Failed to deallocate item to business inventory:', error)
      return false
    }
  }

  private async executeAllocateItemToProject(
    operation: AllocateItemToProjectOperation
  ): Promise<boolean> {
    const { accountId } = operation
    const { itemId, projectId, amount, notes, space } = operation.data

    try {
      const { unifiedItemsService } = await import('./inventoryService')
      await unifiedItemsService.allocateItemToProject(
        accountId,
        itemId,
        projectId,
        amount,
        notes,
        space,
        { queueIfOffline: false }
      )
      await this.verifyCanonicalInvariants(operation)
      return true
    } catch (error) {
      console.error('Failed to allocate item to project:', error)
      return false
    }
  }

  private async executeSellItemToProject(
    operation: SellItemToProjectOperation
  ): Promise<boolean> {
    const { accountId } = operation
    const { itemId, sourceProjectId, targetProjectId, amount, notes, space } = operation.data

    try {
      const { unifiedItemsService } = await import('./inventoryService')
      await unifiedItemsService.sellItemToProject(
        accountId,
        itemId,
        sourceProjectId,
        targetProjectId,
        { amount, notes, space },
        { queueIfOffline: false }
      )
      await this.verifyCanonicalInvariants(operation)
      return true
    } catch (error) {
      console.error('Failed to sell item to project:', error)
      return false
    }
  }

  private async verifyCanonicalInvariants(operation: Operation): Promise<void> {
    if (
      operation.type !== 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY' &&
      operation.type !== 'ALLOCATE_ITEM_TO_PROJECT' &&
      operation.type !== 'SELL_ITEM_TO_PROJECT'
    ) {
      return
    }

    const accountId = operation.accountId
    const itemId = this.getOperationTargetItemId(operation)
    if (!itemId) {
      return
    }

    try {
      const { unifiedItemsService, isCanonicalTransactionId } = await import('./inventoryService')
      const { lineageService } = await import('./lineageService')
      const item = await unifiedItemsService.getItemById(accountId, itemId)

      if (!item) {
        console.warn('Canonical invariant check failed: item not found after sync', {
          operationId: operation.id,
          operationType: operation.type,
          itemId
        })
        return
      }

      let expectedProjectId: string | null | undefined
      let expectedTransactionId: string | null | undefined
      let allowNullTransaction = false

      if (operation.type === 'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY') {
        const { projectId } = operation.data
        expectedProjectId = null
        expectedTransactionId = `INV_SALE_${projectId}`
        allowNullTransaction = true
      } else if (operation.type === 'ALLOCATE_ITEM_TO_PROJECT') {
        const { projectId } = operation.data
        expectedProjectId = projectId
        expectedTransactionId = `INV_PURCHASE_${projectId}`
      } else if (operation.type === 'SELL_ITEM_TO_PROJECT') {
        const { targetProjectId } = operation.data
        expectedProjectId = targetProjectId
        expectedTransactionId = `INV_PURCHASE_${targetProjectId}`
      }

      if (expectedProjectId !== undefined && item.projectId !== expectedProjectId) {
        console.warn('Canonical invariant mismatch: projectId', {
          operationId: operation.id,
          operationType: operation.type,
          itemId,
          expectedProjectId,
          actualProjectId: item.projectId ?? null
        })
      }

      if (expectedTransactionId) {
        const transactionId = item.transactionId ?? null
        if (!transactionId && allowNullTransaction) {
          console.info('Canonical invariant check: no transaction after deallocation (purchase reversion)', {
            operationId: operation.id,
            itemId
          })
          return
        }

        if (transactionId !== expectedTransactionId) {
          console.warn('Canonical invariant mismatch: transactionId', {
            operationId: operation.id,
            operationType: operation.type,
            itemId,
            expectedTransactionId,
            actualTransactionId: transactionId
          })
        }

        if (transactionId && !isCanonicalTransactionId(transactionId)) {
          console.warn('Canonical invariant mismatch: non-canonical transaction', {
            operationId: operation.id,
            operationType: operation.type,
            itemId,
            actualTransactionId: transactionId
          })
        }

        if (transactionId && item.latestTransactionId !== transactionId) {
          try {
            await lineageService.updateItemLineagePointers(accountId, itemId, transactionId)
          } catch (lineageError) {
            console.warn('Failed to refresh lineage pointers after canonical sync', {
              operationId: operation.id,
              itemId,
              lineageError
            })
          }
        }
      }
    } catch (error) {
      console.warn('Canonical invariant check failed (non-fatal):', {
        operationId: operation.id,
        operationType: operation.type,
        itemId,
        error
      })
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
        syncStatus: (op as any).syncStatus,
        interventionReason: (op as any).interventionReason,
        pausedAt: (op as any).pausedAt,
        errorCode: (op as any).errorCode,
        errorDetails: (op as any).errorDetails,
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

  getRunnableQueueLength(): number {
    return this.queue.filter(op => !this.isOperationPaused(op)).length
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
      syncStatus: (op as any).syncStatus,
      interventionReason: (op as any).interventionReason,
      pausedAt: (op as any).pausedAt,
      errorCode: (op as any).errorCode,
      errorDetails: (op as any).errorDetails,
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

  async getEntityIdsWithPendingCreates(
    entityType: 'item' | 'transaction' | 'project'
  ): Promise<Set<string>> {
    await this.init()

    const pendingIds = new Set<string>()
    const createTypes = this.getCreateOperationTypes(entityType)

    if (createTypes.length === 0) {
      return pendingIds
    }

    for (const operation of this.queue) {
      if (!createTypes.includes(operation.type)) {
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

  /**
   * Discard a paused "missing item on server" issue:
   * - Removes ALL queued operations targeting the item
   * - Deletes the local item (best-effort) so local matches the server
   */
  async discardMissingItemSyncIssue(operationId: string): Promise<boolean> {
    await this.init()

    const operation = this.queue.find(op => op.id === operationId) ?? null
    if (!operation) {
      // If it isn't in memory, it's likely already been deleted.
      return true
    }

    const itemId = this.getOperationTargetItemId(operation)
    if (!itemId) {
      return this.removeOperation(operationId)
    }

    const accountId = operation.accountId
    let localItem: DBItem | null = null
    try {
      localItem = await offlineStore.getItemById(itemId)
    } catch {
      localItem = null
    }

    // Remove any queued operations for this item so we don't keep failing.
    this.queue = this.queue.filter(op => this.getOperationTargetItemId(op) !== itemId)
    await this.persistQueue()
    this.emitQueueChange()

    // Best-effort local cleanup.
    try {
      await offlineStore.deleteItem(itemId)
      if (accountId) {
        await offlineStore.deleteConflictsForItems(accountId, [itemId])
      }
    } catch (cleanupError) {
      console.warn('[operationQueue] Failed to delete local item during discard (non-fatal)', {
        itemId,
        cleanupError
      })
    }

    try {
      const queryClient = this.getQueryClient()
      if (queryClient) {
        removeItemFromCaches(queryClient, accountId, itemId, {
          projectId: localItem?.projectId ?? null,
          transactionId: localItem?.transactionId ?? null
        })
      }
    } catch (cacheError) {
      console.warn('[operationQueue] Failed to clear query caches during discard (non-fatal)', {
        itemId,
        cacheError
      })
    }

    if (localItem?.projectId) {
      refreshProjectSnapshot(localItem.projectId)
    } else {
      refreshBusinessInventorySnapshot(accountId)
    }

    return true
  }

  /**
   * Convert a paused UPDATE_ITEM (missing on server) into a CREATE_ITEM so the
   * item can be restored from offline data. Other paused UPDATE_ITEM ops for the
   * same item will be automatically unpaused after the create succeeds.
   */
  async recreateMissingItemSyncIssue(operationId: string): Promise<boolean> {
    await this.init()

    const index = this.queue.findIndex(op => op.id === operationId)
    if (index === -1) {
      return false
    }

    const operation = this.queue[index]
    if (operation.type !== 'UPDATE_ITEM') {
      return false
    }

    const itemId = operation.data.id
    const localItem = await offlineStore.getItemById(itemId)
    if (!localItem) {
      operation.lastError = 'Cannot recreate: item is missing locally.'
      await this.persistQueue()
      this.emitQueueChange()
      return false
    }

    const createOperation: CreateItemOperation = {
      ...(operation as any),
      type: 'CREATE_ITEM',
      retryCount: 0,
      lastError: undefined,
      syncStatus: 'pending',
      interventionReason: undefined,
      pausedAt: undefined,
      errorCode: undefined,
      errorDetails: undefined,
      data: {
        id: itemId,
        accountId: operation.accountId,
        projectId: localItem.projectId ?? '',
        name: localItem.name ?? '',
        description: localItem.description ?? undefined,
        purchasePrice: localItem.purchasePrice ?? undefined
      }
    }

    this.queue[index] = createOperation
    await this.persistQueue()
    this.emitQueueChange()

    if (isNetworkOnline()) {
      void this.processQueue()
    }

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
        return [
          'UPDATE_ITEM',
          'DELETE_ITEM',
          'DEALLOCATE_ITEM_TO_BUSINESS_INVENTORY',
          'ALLOCATE_ITEM_TO_PROJECT',
          'SELL_ITEM_TO_PROJECT'
        ]
      case 'transaction':
        return ['UPDATE_TRANSACTION', 'DELETE_TRANSACTION']
      case 'project':
        return ['UPDATE_PROJECT', 'DELETE_PROJECT']
      default:
        return []
    }
  }

  private getCreateOperationTypes(entityType: 'item' | 'transaction' | 'project'): Operation['type'][] {
    switch (entityType) {
      case 'item':
        return ['CREATE_ITEM']
      case 'transaction':
        return ['CREATE_TRANSACTION']
      case 'project':
        return ['CREATE_PROJECT']
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