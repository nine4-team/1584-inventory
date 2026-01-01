import { offlineStore, type DBItem } from './offlineStore'
import { supabase } from './supabase'
import { operationQueue } from './operationQueue'
import type { Item } from '../types'
import type { Operation } from '../types/operations'

export class OfflineItemService {
  private isOnline = navigator.onLine

  constructor() {
    // Listen for network changes
    window.addEventListener('online', () => this.isOnline = true)
    window.addEventListener('offline', () => this.isOnline = false)
  }

  async getItemsByProject(
    accountId: string,
    projectId: string,
    _filters?: any,
    _pagination?: any
  ): Promise<Item[]> {
    // Offline-aware query: try network first, fall back to cache
    try {
      if (this.isOnline) {
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

  async createItem(accountId: string, itemData: {
    projectId: string
    name: string
    description?: string
    quantity: number
    unitCost: number
  }): Promise<void> {
    await offlineStore.init().catch(() => {})
    const timestamp = new Date().toISOString()
    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'CREATE_ITEM',
      data: {
        ...itemData,
        accountId
      }
    }

    await operationQueue.add(operation, {
      accountId,
      version: 1,
      timestamp
    })

    // Optimistically update local store
    const tempId = `temp-${Date.now()}`
    const tempItem: DBItem = {
      itemId: tempId,
      accountId,
      projectId: itemData.projectId,
      name: itemData.name,
      description: itemData.description || '',
      source: 'manual',
      sku: `TEMP-${Date.now()}`,
      paymentMethod: 'cash',
      qrKey: crypto.randomUUID(),
      bookmark: false,
      dateCreated: timestamp,
      lastUpdated: timestamp,
      version: 1
    }

    await offlineStore.saveItems([tempItem])

    // Trigger immediate processing if online
    if (navigator.onLine) {
      operationQueue.processQueue()
    }
  }

  async updateItem(accountId: string, itemId: string, updates: Partial<{
    name: string
    description: string
    quantity: number
    unitCost: number
  }>): Promise<void> {
    await offlineStore.init().catch(() => {})
    const allItems = await offlineStore.getAllItems().catch(() => []) as DBItem[]
    const itemToUpdate = allItems.find(item => item.itemId === itemId) || null
    const nextVersion = (itemToUpdate?.version ?? 0) + 1
    const timestamp = new Date().toISOString()

    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'UPDATE_ITEM',
      data: { id: itemId, accountId, updates }
    }

    await operationQueue.add(operation, {
      accountId,
      version: nextVersion,
      timestamp
    })

    if (itemToUpdate) {
      const optimisticItem = {
        ...itemToUpdate,
        ...updates,
        lastUpdated: timestamp,
        version: nextVersion
      }
      await offlineStore.saveItems([optimisticItem])
    }

    // Trigger immediate processing if online
    if (navigator.onLine) {
      operationQueue.processQueue()
    }
  }

  async deleteItem(accountId: string, itemId: string): Promise<void> {
    await offlineStore.init().catch(() => {})
    const existingItem = await offlineStore.getItemById(itemId).catch(() => null as DBItem | null)
    const timestamp = new Date().toISOString()

    const operation: Omit<Operation, 'id' | 'timestamp' | 'retryCount' | 'accountId' | 'updatedBy' | 'version'> = {
      type: 'DELETE_ITEM',
      data: { id: itemId, accountId }
    }

    await operationQueue.add(operation, {
      accountId,
      version: existingItem?.version ?? 1,
      timestamp
    })

    // Note: Optimistic deletion from local store would be complex
    // since we need to track deletions. For now, we'll let the
    // React Query invalidation handle this when sync completes.

    // Trigger immediate processing if online
    if (navigator.onLine) {
      operationQueue.processQueue()
    }
  }

  private convertDbItemToItem(dbItem: DBItem): Item {
    return {
      itemId: dbItem.itemId,
      accountId: dbItem.accountId,
      projectId: dbItem.projectId,
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