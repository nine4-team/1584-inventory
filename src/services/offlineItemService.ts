import { offlineStore, type DBItem, mapSupabaseItemToOfflineRecord } from './offlineStore'
import { supabase } from './supabase'
import { operationQueue } from './operationQueue'
import type { Item } from '../types'
import type { Operation } from '../types/operations'
import { isNetworkOnline } from './networkStatusService'
import { refreshBusinessInventorySnapshot, refreshProjectSnapshot } from '../utils/realtimeSnapshotUpdater'
import { removeItemFromCaches } from '@/utils/queryCacheHelpers'
import type { QueryClient } from '@tanstack/react-query'

export interface OfflineOperationResult {
  operationId: string
  wasQueued: boolean
  itemId?: string
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

export class OfflineItemService {
  async getItemsByProject(
    accountId: string,
    projectId: string,
    _filters?: any,
    _pagination?: any
  ): Promise<Item[]> {
    // Offline-aware query: try network first, fall back to cache
    try {
      if (isNetworkOnline()) {
        // Fetch from Supabase
        const { data, error } = await supabase
          .from('items')
          .select('*')
          .eq('account_id', accountId)
          .eq('project_id', projectId)
          .order('last_updated', { ascending: false })

        if (error) throw error

        // Convert to DB format and cache
        const dbItems: DBItem[] = data.map(item => ({
          itemId: item.id,
          accountId: item.account_id,
          projectId: item.project_id,
          transactionId: item.transaction_id,
          previousProjectTransactionId: item.previous_project_transaction_id ?? null,
          previousProjectId: item.previous_project_id ?? null,
          name: item.name,
          description: item.description,
          source: item.source,
          sku: item.sku,
          price: item.price,
          purchasePrice: item.purchase_price,
          projectPrice: item.project_price,
          marketValue: item.market_value,
          paymentMethod: item.payment_method,
          disposition: item.disposition,
          notes: item.notes,
          space: item.space,
          qrKey: item.qr_key,
          bookmark: item.bookmark,
          dateCreated: item.date_created,
          lastUpdated: item.last_updated,
          createdAt: item.created_at,
          images: item.images ?? [],
          taxRatePct: item.tax_rate_pct,
          taxAmountPurchasePrice: item.tax_amount_purchase_price,
          taxAmountProjectPrice: item.tax_amount_project_price,
          createdBy: item.created_by,
          inventoryStatus: item.inventory_status,
          businessInventoryLocation: item.business_inventory_location,
          originTransactionId: item.origin_transaction_id,
          latestTransactionId: item.latest_transaction_id,
          version: item.version || 1,
          last_synced_at: new Date().toISOString()
        }))
        await offlineStore.saveItems(dbItems)

        // Convert back to Item format
        return data.map(this.convertDbItemToItem)
      }
    } catch (error) {
      console.warn('Network request failed, falling back to cache:', error)
    }

    // Fall back to cache
    const cached = await offlineStore.getItems(projectId)
    return cached.map(this.convertDbItemToItem)
  }

  /**
   * Create an item offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async createItem(
    accountId: string,
    itemData: Omit<Item, 'itemId' | 'dateCreated' | 'lastUpdated'>,
    options?: { itemId?: string }
  ): Promise<OfflineOperationResult> {
    try {
      await offlineStore.init()
    } catch (error) {
      console.error('Offline storage unavailable during createItem:', error)
      throw new OfflineQueueUnavailableError(
        'Offline storage is unavailable. Please refresh or try again online.',
        error
      )
    }

    const timestamp = new Date().toISOString()
    const itemId = options?.itemId ?? `I-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
    const qrKey = itemData.qrKey || `QR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
    const disposition = itemData.disposition ?? 'purchased'

    // Optimistically update local store with full item data
    const tempItem: DBItem = {
      itemId,
      accountId,
      projectId: itemData.projectId ?? null,
      transactionId: itemData.transactionId ?? null,
      previousProjectTransactionId: itemData.previousProjectTransactionId ?? null,
      previousProjectId: itemData.previousProjectId ?? null,
      name: itemData.name,
      description: itemData.description ?? null,
      source: itemData.source ?? null,
      sku: itemData.sku ?? null,
      purchasePrice: itemData.purchasePrice ?? null,
      projectPrice: itemData.projectPrice ?? null,
      marketValue: itemData.marketValue ?? null,
      paymentMethod: itemData.paymentMethod ?? null,
      disposition,
      notes: itemData.notes,
      space: itemData.space,
      qrKey,
      bookmark: itemData.bookmark ?? false,
      dateCreated: itemData.dateCreated || timestamp,
      lastUpdated: timestamp,
      createdAt: itemData.createdAt ? (typeof itemData.createdAt === 'string' ? itemData.createdAt : itemData.createdAt.toISOString()) : timestamp,
      images: itemData.images || [],
      taxRatePct: itemData.taxRatePct,
      taxAmountPurchasePrice: itemData.taxAmountPurchasePrice,
      taxAmountProjectPrice: itemData.taxAmountProjectPrice,
      createdBy: itemData.createdBy,
      inventoryStatus: itemData.inventoryStatus,
      businessInventoryLocation: itemData.businessInventoryLocation,
      originTransactionId: itemData.originTransactionId ?? null,
      latestTransactionId: itemData.latestTransactionId ?? null,
      version: 1,
      last_synced_at: null // Not synced yet
    }

    try {
      await offlineStore.saveItems([tempItem])
      console.debug('Persisted optimistic offline item before queueing create', {
        itemId,
        projectId: tempItem.projectId
      })
    } catch (error) {
      console.error('Failed to cache optimistic item before queueing CREATE operation', error)
      throw new OfflineQueueUnavailableError(
        'Unable to cache the item for offline sync. Free some storage or retry online.',
        error
      )
    }

    // Convert Item to operation format
    // Note: operationQueue.executeCreateItem expects simplified data, but we'll store full itemData
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'CREATE_ITEM',
      data: {
        id: itemId, // item_id (business identifier) - must be provided
        accountId,
        projectId: itemData.projectId || '',
        name: itemData.name || '',
        description: itemData.description,
        purchasePrice: itemData.purchasePrice // Include actual purchase price
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
      console.error('Failed to enqueue CREATE_ITEM operation after caching optimistic data', error)
      // Attempt to roll back local cache entry so we do not keep orphaned items
      try {
        await offlineStore.deleteItem(itemId)
      } catch (rollbackError) {
        console.warn('Unable to roll back optimistic item after queue failure', rollbackError)
      }
      throw error
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    if (import.meta.env.DEV) {
      console.info('[offlineItemService] queued CREATE_ITEM for offline sync', {
        accountId,
        itemId,
        operationId
      })
    }

    // Refresh realtime snapshot if item belongs to a project
    if (itemData.projectId) {
      refreshProjectSnapshot(itemData.projectId)
    }
    if (!itemData.projectId) {
      refreshBusinessInventorySnapshot(accountId)
    }

    return { operationId, wasQueued: true, itemId }
  }

  /**
   * Update an item offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async updateItem(
    accountId: string,
    itemId: string,
    updates: Partial<Item>
  ): Promise<OfflineOperationResult> {
    await offlineStore.init().catch(() => {})
    
    // Hydrate from offlineStore first
    const allItems = await offlineStore.getAllItems().catch(() => []) as DBItem[]
    const itemToUpdate = allItems.find(item => item.itemId === itemId) || null
    
    if (!itemToUpdate) {
      throw new Error(`Item ${itemId} not found in offline store`)
    }
    
    const nextVersion = (itemToUpdate.version ?? 0) + 1
    const timestamp = new Date().toISOString()

    // Convert Item updates to operation format
    // Note: operationQueue.executeUpdateItem expects simplified updates, but we'll store full updates
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'UPDATE_ITEM',
      data: {
        id: itemId,
        accountId,
        updates: {
          name: updates.name,
          description: updates.description,
          purchasePrice: updates.purchasePrice // Include actual purchase price if updated
        }
      }
    }

    const optimisticItem: DBItem = {
      ...itemToUpdate,
      ...(updates.projectId !== undefined && { projectId: updates.projectId ?? null }),
      ...(updates.transactionId !== undefined && { transactionId: updates.transactionId ?? null }),
      ...(updates.previousProjectTransactionId !== undefined && { previousProjectTransactionId: updates.previousProjectTransactionId ?? null }),
      ...(updates.previousProjectId !== undefined && { previousProjectId: updates.previousProjectId ?? null }),
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description ?? null }),
      ...(updates.source !== undefined && { source: updates.source ?? null }),
      ...(updates.sku !== undefined && { sku: updates.sku ?? null }),
      ...(updates.purchasePrice !== undefined && { purchasePrice: updates.purchasePrice ?? null }),
      ...(updates.projectPrice !== undefined && { projectPrice: updates.projectPrice ?? null }),
      ...(updates.marketValue !== undefined && { marketValue: updates.marketValue ?? null }),
      ...(updates.paymentMethod !== undefined && { paymentMethod: updates.paymentMethod ?? null }),
      ...(updates.disposition !== undefined && { disposition: updates.disposition ?? null }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
      ...(updates.space !== undefined && { space: updates.space }),
      ...(updates.bookmark !== undefined && { bookmark: updates.bookmark ?? false }),
      ...(updates.images !== undefined && { images: updates.images || [] }),
      ...(updates.taxRatePct !== undefined && { taxRatePct: updates.taxRatePct }),
      ...(updates.taxAmountPurchasePrice !== undefined && { taxAmountPurchasePrice: updates.taxAmountPurchasePrice }),
      ...(updates.taxAmountProjectPrice !== undefined && { taxAmountProjectPrice: updates.taxAmountProjectPrice }),
      ...(updates.inventoryStatus !== undefined && { inventoryStatus: updates.inventoryStatus }),
      ...(updates.businessInventoryLocation !== undefined && { businessInventoryLocation: updates.businessInventoryLocation }),
      ...(updates.createdAt !== undefined && { createdAt: typeof updates.createdAt === 'string' ? updates.createdAt : updates.createdAt.toISOString() }),
      lastUpdated: timestamp,
      version: nextVersion
    }

    try {
      await offlineStore.saveItems([optimisticItem])
    } catch (error) {
      console.error('Failed to persist optimistic item before queueing UPDATE operation', error)
      throw new OfflineQueueUnavailableError(
        'Unable to save the item offline. Free some storage or retry online.',
        error
      )
    }

    let operationId: string
    try {
      operationId = await operationQueue.add(operation, {
        accountId,
        version: nextVersion,
        timestamp
      })
    } catch (error) {
      console.error('Failed to enqueue UPDATE_ITEM operation after caching optimistic data', error)
      try {
        await offlineStore.saveItems([itemToUpdate])
      } catch (rollbackError) {
        console.warn('Unable to roll back optimistic item after queue failure', rollbackError)
      }
      throw error
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    // Refresh realtime snapshot if item belongs to a project
    const projectId = optimisticItem.projectId || itemToUpdate.projectId
    if (projectId) {
      refreshProjectSnapshot(projectId)
    }
    const prevProjectId = itemToUpdate.projectId ?? null
    const nextProjectId = optimisticItem.projectId ?? null
    if (!prevProjectId || !nextProjectId) {
      refreshBusinessInventorySnapshot(accountId)
    }

    return { operationId, wasQueued: true, itemId }
  }

  /**
   * Delete an item offline by queuing it for sync
   * Returns the operation ID for tracking/retry purposes
   */
  async deleteItem(accountId: string, itemId: string): Promise<OfflineOperationResult> {
    await offlineStore.init().catch(() => {})
    
    // Hydrate from offlineStore first
    const existingItem = await offlineStore.getItemById(itemId).catch(() => null as DBItem | null)
    
    if (!existingItem) {
      throw new Error(`Item ${itemId} not found in offline store`)
    }
    
    const timestamp = new Date().toISOString()

    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'DELETE_ITEM',
      data: { id: itemId, accountId }
    }

    let operationId: string
    try {
      operationId = await operationQueue.add(operation, {
        accountId,
        version: existingItem.version ?? 1,
        timestamp
      })
    } catch (error) {
      console.error('Failed to enqueue DELETE_ITEM operation', {
        accountId,
        itemId,
        error
      })
      try {
        await offlineStore.saveItems([existingItem])
      } catch (saveError) {
        console.error('Failed to re-save item after queue enqueue failure', {
          itemId,
          saveError
        })
      }
      throw error
    }

    // Delete optimistically from local store immediately after enqueueing
    try {
      await offlineStore.deleteItem(itemId)
      await offlineStore.deleteConflictsForItems(accountId, [itemId])

      console.info('Item deleted offline', {
        itemId,
        accountId,
        projectId: existingItem.projectId,
        transactionId: existingItem.transactionId
      })

      try {
        const queryClient = tryGetQueryClient()
        if (queryClient) {
          removeItemFromCaches(queryClient, accountId, itemId, {
            projectId: existingItem.projectId,
            transactionId: existingItem.transactionId
          })
          queryClient.invalidateQueries({ queryKey: ['item', accountId, itemId] })
          if (existingItem.projectId) {
            queryClient.invalidateQueries({ queryKey: ['project-items', accountId, existingItem.projectId] })
          } else {
            queryClient.invalidateQueries({ queryKey: ['business-inventory', accountId] })
          }
          if (existingItem.transactionId) {
            queryClient.invalidateQueries({ queryKey: ['transaction-items', accountId, existingItem.transactionId] })
          }
        }
      } catch (cacheError) {
        console.warn('Failed to invalidate React Query after offline item delete (non-fatal)', {
          itemId,
          cacheError
        })
      }
    } catch (cleanupError) {
      console.warn('Failed to purge item from offline store after enqueueing delete (non-fatal)', {
        itemId,
        cleanupError
      })
    }

    // Trigger immediate processing if online
    if (isNetworkOnline()) {
      operationQueue.processQueue()
    }

    // Refresh realtime snapshot if item belongs to a project
    if (existingItem.projectId) {
      refreshProjectSnapshot(existingItem.projectId)
    }
    if (!existingItem.projectId) {
      refreshBusinessInventorySnapshot(accountId)
    }

    return { operationId, wasQueued: true, itemId }
  }

  private convertDbItemToItem(dbItem: DBItem): Item {
    return {
      itemId: dbItem.itemId,
      accountId: dbItem.accountId,
      projectId: dbItem.projectId,
      transactionId: dbItem.transactionId,
      previousProjectTransactionId: dbItem.previousProjectTransactionId,
      previousProjectId: dbItem.previousProjectId,
      name: dbItem.name,
      description: dbItem.description,
      source: dbItem.source,
      sku: dbItem.sku,
      price: dbItem.price,
      purchasePrice: dbItem.purchasePrice,
      projectPrice: dbItem.projectPrice,
      marketValue: dbItem.marketValue,
      paymentMethod: dbItem.paymentMethod,
      disposition: dbItem.disposition as any,
      notes: dbItem.notes,
      space: dbItem.space,
      qrKey: dbItem.qrKey,
      bookmark: dbItem.bookmark,
      dateCreated: dbItem.dateCreated,
      lastUpdated: dbItem.lastUpdated,
      createdAt: dbItem.createdAt ? new Date(dbItem.createdAt) : undefined,
      images: dbItem.images,
      taxRatePct: dbItem.taxRatePct,
      taxAmountPurchasePrice: dbItem.taxAmountPurchasePrice,
      taxAmountProjectPrice: dbItem.taxAmountProjectPrice,
      createdBy: dbItem.createdBy,
      inventoryStatus: dbItem.inventoryStatus,
      businessInventoryLocation: dbItem.businessInventoryLocation,
      originTransactionId: dbItem.originTransactionId,
      latestTransactionId: dbItem.latestTransactionId
    }
  }
}

export const offlineItemService = new OfflineItemService()