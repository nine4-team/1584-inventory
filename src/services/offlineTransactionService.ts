import { offlineStore, type DBTransaction } from './offlineStore'
import { operationQueue } from './operationQueue'
import type { Transaction, TransactionItemFormData } from '../types'
import type { Operation } from '../types/operations'
import { isNetworkOnline } from './networkStatusService'
import { offlineItemService } from './offlineItemService'
import { getCachedBudgetCategoryById, getCachedTaxPresetById } from './offlineMetadataService'
import { refreshProjectSnapshot } from '../utils/realtimeSnapshotUpdater'
import { removeTransactionFromCaches } from '@/utils/queryCacheHelpers'
import type { QueryClient } from '@tanstack/react-query'

export interface OfflineOperationResult {
  operationId: string
  wasQueued: boolean
  transactionId?: string
}

type CreatedChildItem = {
  itemId?: string
  operationId?: string
}

export class OfflineStorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'OfflineStorageError'
  }
}

export class OfflineQueueUnavailableError extends OfflineStorageError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'OfflineQueueUnavailableError'
  }
}

type QueryClientGetter = () => QueryClient

let cachedGetGlobalQueryClient: QueryClientGetter | null = null
function tryGetQueryClient(): QueryClient | null {
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

export class MissingOfflinePrerequisiteError extends OfflineStorageError {
  constructor(message: string, public readonly missingPrerequisite: string, cause?: unknown) {
    super(message, cause)
    this.name = 'MissingOfflinePrerequisiteError'
  }
}

export class OfflineTransactionService {
  /**
   * Create a transaction offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async createTransaction(
    accountId: string,
    projectId: string | null | undefined,
    transactionData: Omit<Transaction, 'transactionId' | 'createdAt'>,
    items?: TransactionItemFormData[]
  ): Promise<OfflineOperationResult> {
    try {
      await offlineStore.init()
    } catch (error) {
      console.error('Offline storage unavailable during createTransaction:', error)
      throw new OfflineQueueUnavailableError(
        'Offline storage is unavailable. Please refresh or try again online.',
        error
      )
    }

    // Validate metadata prerequisites
    if (transactionData.categoryId) {
      const category = await getCachedBudgetCategoryById(accountId, transactionData.categoryId)
      if (!category) {
        throw new MissingOfflinePrerequisiteError(
          `Budget category '${transactionData.categoryId}' not found in offline cache. Go online and sync categories before creating transactions offline.`,
          'budgetCategory',
          { categoryId: transactionData.categoryId }
        )
      }
    }

    if (transactionData.taxRatePreset && transactionData.taxRatePreset !== 'Other') {
      const preset = await getCachedTaxPresetById(accountId, transactionData.taxRatePreset)
      if (!preset) {
        throw new MissingOfflinePrerequisiteError(
          `Tax preset '${transactionData.taxRatePreset}' not found in offline cache. Go online and sync tax presets before creating transactions offline.`,
          'taxPreset',
          { presetId: transactionData.taxRatePreset }
        )
      }
    }

    const timestamp = new Date().toISOString()
    const transactionId = `T-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`

    // Calculate initial sum from provided items (if any) or default to '0.00'
    let sum = 0
    if (items && items.length > 0) {
      for (const itemData of items) {
        const price = itemData.purchasePrice || itemData.projectPrice || '0'
        const parsed = parseFloat(price)
        if (!isNaN(parsed)) {
          sum += parsed
        }
      }
    }
    const initialSumItemPurchasePrices = sum.toFixed(2)

    // Convert transaction data to DB format
    // Ensure sumItemPurchasePrices is always set (never undefined) to prevent null constraint violations
    const tempTransaction: DBTransaction = {
      transactionId,
      accountId,
      projectId: projectId ?? null,
    projectName: transactionData.projectName ?? null,
      transactionDate: transactionData.transactionDate,
      source: transactionData.source || '',
      transactionType: transactionData.transactionType || '',
      paymentMethod: transactionData.paymentMethod || '',
      amount: transactionData.amount || '0.00',
      budgetCategory: transactionData.budgetCategory,
      categoryId: transactionData.categoryId,
      notes: transactionData.notes,
      transactionImages: transactionData.transactionImages,
      receiptImages: transactionData.receiptImages,
      otherImages: transactionData.otherImages,
      receiptEmailed: transactionData.receiptEmailed ?? false,
      createdAt: timestamp,
      createdBy: transactionData.createdBy || '',
      status: transactionData.status || 'completed',
      reimbursementType: transactionData.reimbursementType ?? null,
      triggerEvent: transactionData.triggerEvent ?? null,
      taxRatePreset: transactionData.taxRatePreset ?? null,
      taxRatePct: transactionData.taxRatePct,
      subtotal: transactionData.subtotal,
      needsReview: transactionData.needsReview ?? false,
      sumItemPurchasePrices: transactionData.sumItemPurchasePrices ?? initialSumItemPurchasePrices,
      itemIds: transactionData.itemIds || [],
      version: 1,
      last_synced_at: null // Not synced yet
    }

    try {
      await offlineStore.saveTransactions([tempTransaction])
      console.debug('Persisted optimistic offline transaction before queueing create', {
        transactionId,
        projectId: tempTransaction.projectId
      })
    } catch (error) {
      console.error('Failed to cache optimistic transaction before queueing CREATE operation', error)
      throw new OfflineQueueUnavailableError(
        'Unable to cache the transaction for offline sync. Free some storage or retry online.',
        error
      )
    }

    // Create child items if provided (delegate to offlineItemService)
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'CREATE_TRANSACTION',
      data: {
        id: transactionId,
        accountId,
        projectId: projectId ?? null
      }
    }

    let operationId: string
    try {
      operationId = await operationQueue.add(operation, {
        accountId,
        version: 1,
        timestamp
      })
    } catch (error) {
      console.error('Failed to enqueue CREATE_TRANSACTION operation after caching optimistic data', error)
      try {
        await offlineStore.deleteTransaction(transactionId)
      } catch (rollbackError) {
        console.warn('Unable to roll back optimistic transaction after queue failure', rollbackError)
      }
      throw error
    }

    const createdChildItems: CreatedChildItem[] = []
    if (items && items.length > 0) {
      try {
        for (const itemData of items) {
          const disposition = itemData.disposition ?? 'purchased'
          const itemResult = await offlineItemService.createItem(accountId, {
            projectId: projectId ?? undefined,
            transactionId: transactionId,
            name: itemData.description || '',
            description: itemData.description || '',
            source: transactionData.source || '',
            sku: itemData.sku || '',
            purchasePrice: itemData.purchasePrice,
            projectPrice: itemData.projectPrice,
            marketValue: itemData.marketValue,
            paymentMethod: transactionData.paymentMethod || '',
            disposition,
            notes: itemData.notes,
            space: itemData.space,
            dateCreated: transactionData.transactionDate || timestamp,
            taxRatePct: transactionData.taxRatePct,
            taxAmountPurchasePrice: itemData.taxAmountPurchasePrice,
            taxAmountProjectPrice: itemData.taxAmountProjectPrice,
            images: itemData.images || [],
            inventoryStatus: 'available',
            createdBy: transactionData.createdBy || ''
          })
          createdChildItems.push({
            itemId: itemResult.itemId,
            operationId: itemResult.operationId
          })
        }

        // Recompute sum from the items array that was just processed
        // This ensures the cached sum matches the optimistic child items
        let recomputedSum = 0
        for (const itemData of items) {
          const price = itemData.purchasePrice || itemData.projectPrice || '0'
          const parsed = parseFloat(price)
          if (!isNaN(parsed)) {
            recomputedSum += parsed
          }
        }
        tempTransaction.sumItemPurchasePrices = recomputedSum.toFixed(2)

        // Update transaction with created item IDs and recomputed sum
        const createdItemIds = createdChildItems
          .map(child => child.itemId)
          .filter((id): id is string => Boolean(id))

        tempTransaction.itemIds = createdItemIds
        await offlineStore.saveTransactions([tempTransaction])
        
        if (import.meta.env.DEV) {
          console.debug('[offlineTransactionService] Updated transaction with recomputed sumItemPurchasePrices', {
            transactionId,
            sumItemPurchasePrices: tempTransaction.sumItemPurchasePrices,
            itemCount: createdItemIds.length
          })
        }
      } catch (itemError) {
        console.error('Failed to create child items for transaction:', itemError)
        // Rollback transaction if item creation fails
        try {
          await offlineStore.deleteTransaction(transactionId)
        } catch (rollbackError) {
          console.warn('Failed to rollback transaction after item creation failure', rollbackError)
        }
        await this.rollbackChildItems(createdChildItems)
        try {
          await operationQueue.removeOperation(operationId)
        } catch (removeError) {
          console.warn('Failed to remove queued transaction operation during rollback', {
            operationId,
            removeError
          })
        }
        throw itemError
      }
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    if (import.meta.env.DEV) {
      console.info('[offlineTransactionService] queued CREATE_TRANSACTION for offline sync', {
        accountId,
        transactionId,
        operationId
      })
    }

    // Refresh realtime snapshot if transaction belongs to a project
    if (projectId) {
      refreshProjectSnapshot(projectId)
    }

    return { operationId, wasQueued: true, transactionId }
  }

  /**
   * Update a transaction offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async updateTransaction(
    accountId: string,
    transactionId: string,
    updates: Partial<Transaction>
  ): Promise<OfflineOperationResult> {
    await offlineStore.init().catch(() => {})
    
    // Hydrate from offlineStore first
    const existingTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null) as DBTransaction | null
    
    if (!existingTransaction) {
      throw new Error(`Transaction ${transactionId} not found in offline store`)
    }

    if (existingTransaction.accountId !== accountId) {
      throw new Error(`Transaction ${transactionId} does not belong to account ${accountId}`)
    }

    // Validate metadata prerequisites if category is being updated
    if (updates.categoryId !== undefined && updates.categoryId !== null) {
      const category = await getCachedBudgetCategoryById(accountId, updates.categoryId)
      if (!category) {
        throw new MissingOfflinePrerequisiteError(
          `Budget category '${updates.categoryId}' not found in offline cache. Go online and sync categories before updating transactions offline.`,
          'budgetCategory',
          { categoryId: updates.categoryId }
        )
      }
    }

    // Validate tax preset if being updated
    if (updates.taxRatePreset !== undefined && updates.taxRatePreset !== null && updates.taxRatePreset !== 'Other') {
      const preset = await getCachedTaxPresetById(accountId, updates.taxRatePreset)
      if (!preset) {
        throw new MissingOfflinePrerequisiteError(
          `Tax preset '${updates.taxRatePreset}' not found in offline cache. Go online and sync tax presets before updating transactions offline.`,
          'taxPreset',
          { presetId: updates.taxRatePreset }
        )
      }
    }
    
    const nextVersion = (existingTransaction.version ?? 0) + 1
    const timestamp = new Date().toISOString()

    // Convert Transaction updates to operation format
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'UPDATE_TRANSACTION',
      data: {
        id: transactionId,
        accountId,
        updates: {
          amount: updates.amount,
          categoryId: updates.categoryId,
          taxRatePreset: updates.taxRatePreset,
          status: updates.status,
          receiptImages: updates.receiptImages,
          otherImages: updates.otherImages,
          transactionImages: updates.transactionImages
        }
      }
    }

    const operationId = await operationQueue.add(operation, {
      accountId,
      version: nextVersion,
      timestamp
    })

    // Optimistically update local store
    const optimisticTransaction: DBTransaction = {
      ...existingTransaction,
      ...(updates.projectId !== undefined && { projectId: updates.projectId ?? null }),
      ...(updates.transactionDate !== undefined && { transactionDate: updates.transactionDate }),
      ...(updates.source !== undefined && { source: updates.source }),
      ...(updates.transactionType !== undefined && { transactionType: updates.transactionType }),
      ...(updates.paymentMethod !== undefined && { paymentMethod: updates.paymentMethod }),
      ...(updates.amount !== undefined && { amount: updates.amount }),
      ...(updates.budgetCategory !== undefined && { budgetCategory: updates.budgetCategory }),
      ...(updates.categoryId !== undefined && { categoryId: updates.categoryId }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
      ...(updates.receiptEmailed !== undefined && { receiptEmailed: updates.receiptEmailed }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.reimbursementType !== undefined && { reimbursementType: updates.reimbursementType ?? null }),
      ...(updates.triggerEvent !== undefined && { triggerEvent: updates.triggerEvent ?? null }),
      ...(updates.taxRatePreset !== undefined && { taxRatePreset: updates.taxRatePreset ?? null }),
      ...(updates.taxRatePct !== undefined && { taxRatePct: updates.taxRatePct }),
      ...(updates.subtotal !== undefined && { subtotal: updates.subtotal }),
      ...(updates.needsReview !== undefined && { needsReview: updates.needsReview }),
      ...(updates.sumItemPurchasePrices !== undefined && { sumItemPurchasePrices: updates.sumItemPurchasePrices }),
      ...(updates.itemIds !== undefined && { itemIds: updates.itemIds || [] }),
      ...(updates.transactionImages !== undefined && { transactionImages: updates.transactionImages }),
      ...(updates.receiptImages !== undefined && { receiptImages: updates.receiptImages }),
      ...(updates.otherImages !== undefined && { otherImages: updates.otherImages }),
      version: nextVersion
    }
    
    await offlineStore.saveTransactions([optimisticTransaction])

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    // Refresh realtime snapshot if transaction belongs to a project
    const projectId = optimisticTransaction.projectId || existingTransaction.projectId
    if (projectId) {
      refreshProjectSnapshot(projectId)
    }

    return { operationId, wasQueued: true, transactionId }
  }

  /**
   * Delete a transaction offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async deleteTransaction(accountId: string, transactionId: string): Promise<OfflineOperationResult> {
    await offlineStore.init().catch(() => {})
    
    // Hydrate from offlineStore first
    const existingTransaction = await offlineStore.getTransactionById(transactionId).catch(() => null) as DBTransaction | null
    
    if (!existingTransaction) {
      throw new Error(`Transaction ${transactionId} not found in offline store`)
    }

    if (existingTransaction.accountId !== accountId) {
      throw new Error(`Transaction ${transactionId} does not belong to account ${accountId}`)
    }
    
    const timestamp = new Date().toISOString()

    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'DELETE_TRANSACTION',
      data: { id: transactionId, accountId }
    }

    let operationId: string
    try {
      operationId = await operationQueue.add(operation, {
        accountId,
        version: existingTransaction.version ?? 1,
        timestamp
      })
    } catch (error) {
      console.error('Failed to enqueue DELETE_TRANSACTION operation', {
        accountId,
        transactionId,
        error
      })
      try {
        await offlineStore.saveTransactions([existingTransaction])
      } catch (restoreError) {
        console.error('Failed to re-save transaction after queue enqueue failure', {
          transactionId,
          restoreError
        })
      }
      throw error
    }

    // Remove from offline cache immediately so UI no longer surfaces ghost entries
    try {
      await offlineStore.deleteTransaction(transactionId)
      await offlineStore.deleteConflictsForTransactions(accountId, [transactionId])

      console.info('Transaction deleted offline', {
        transactionId,
        accountId,
        projectId: existingTransaction.projectId
      })

      try {
        const queryClient = tryGetQueryClient()
        if (queryClient) {
          removeTransactionFromCaches(queryClient, accountId, transactionId, existingTransaction.projectId)
          queryClient.invalidateQueries({ queryKey: ['transaction', accountId, transactionId] })
          if (existingTransaction.projectId) {
            queryClient.invalidateQueries({ queryKey: ['project-transactions', accountId, existingTransaction.projectId] })
          }
          queryClient.invalidateQueries({ queryKey: ['transaction-items', accountId, transactionId] })
          queryClient.invalidateQueries({ queryKey: ['transactions', accountId] })
        }
      } catch (cacheError) {
        console.warn('Failed to invalidate React Query after offline transaction delete (non-fatal)', {
          transactionId,
          cacheError
        })
      }
    } catch (cleanupError) {
      console.warn('Failed to purge transaction from offline store after enqueueing delete (non-fatal)', {
        transactionId,
        cleanupError
      })
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    // Refresh realtime snapshot if transaction belongs to a project
    if (existingTransaction.projectId) {
      refreshProjectSnapshot(existingTransaction.projectId)
    }

    return { operationId, wasQueued: true, transactionId }
  }

  private async rollbackChildItems(children: CreatedChildItem[]): Promise<void> {
    if (!children.length) {
      return
    }

    for (const child of children) {
      if (child.itemId) {
        try {
          await offlineStore.deleteItem(child.itemId)
        } catch (error) {
          console.warn('Failed to delete optimistic child item during rollback', {
            itemId: child.itemId,
            error
          })
        }
      }

      if (child.operationId) {
        try {
          await operationQueue.removeOperation(child.operationId)
        } catch (error) {
          console.warn('Failed to remove queued child item operation during rollback', {
            operationId: child.operationId,
            error
          })
        }
      }
    }
  }
}

export const offlineTransactionService = new OfflineTransactionService()
