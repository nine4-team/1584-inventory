import { ConflictItem, Resolution, ConflictResolution } from '../types/conflicts'
import { offlineStore } from './offlineStore'
import { supabase } from './supabase'

export class ConflictResolver {
  async resolveConflicts(conflicts: ConflictItem[]): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = []

    for (const conflict of conflicts) {
      const resolution = await this.resolveConflict(conflict)
      resolutions.push({
        itemId: conflict.id,
        resolution,
        timestamp: new Date().toISOString()
      })
    }

    return resolutions
  }

  private async resolveConflict(conflict: ConflictItem): Promise<Resolution> {
    // Strategy 1: Auto-resolve version conflicts (server wins)
    if (conflict.type === 'version') {
      return {
        strategy: 'keep_server',
        resolvedData: conflict.server.data
      }
    }

    // Strategy 2: Auto-resolve timestamp conflicts (server wins if significantly newer)
    if (conflict.type === 'timestamp') {
      const localTime = new Date(conflict.local.timestamp).getTime()
      const serverTime = new Date(conflict.server.timestamp).getTime()
      const diffMinutes = (serverTime - localTime) / (1000 * 60)

      if (diffMinutes > 5) { // Server is more than 5 minutes newer
        return {
          strategy: 'keep_server',
          resolvedData: conflict.server.data
        }
      }
    }

    // Strategy 3: For content conflicts in non-critical fields, keep local
    if (conflict.field === 'description') {
      return {
        strategy: 'keep_local',
        resolvedData: conflict.local.data
      }
    }

    // Strategy 4: For critical conflicts, require manual resolution
    return {
      strategy: 'manual'
    }
  }

  async applyResolution(conflict: ConflictItem, resolution: Resolution): Promise<void> {
    let finalData: Record<string, unknown>

    switch (resolution.strategy) {
      case 'keep_local':
        finalData = conflict.local.data
        break
      case 'keep_server':
        finalData = conflict.server.data
        // Update local store
        await offlineStore.saveItems([{
          ...this.serverToLocalItem(conflict.server.data),
          version: conflict.server.version,
          last_synced_at: new Date().toISOString()
        }])
        return
      case 'merge':
        // Simple merge strategy (server wins, but keep local description if server lacks one)
        finalData = {
          ...conflict.server.data,
          description: conflict.server.data.description || conflict.local.data.description
        }
        break
      case 'manual':
        if (resolution.userChoice === 'local') {
          finalData = conflict.local.data
        } else {
          finalData = conflict.server.data
        }
        break
      default:
        throw new Error(`Unknown resolution strategy: ${resolution.strategy}`)
    }

    // Convert camelCase to snake_case for Supabase canonical column names
    const dbData = this.convertToDatabaseFormat(finalData)

    // Update server with resolved data using canonical column names
    // Match by item_id (business identifier) since conflict.id is the item_id, not the UUID primary key
    const { error } = await supabase
      .from('items')
      .update(dbData)
      .eq('item_id', conflict.id)

    if (error) {
      console.error('Failed to update item in Supabase:', error)
      throw error
    }

    // Update local store
    await offlineStore.saveItems([{
      ...this.serverToLocalItem(finalData),
      version: Math.max(conflict.local.version, conflict.server.version) + 1,
      last_synced_at: new Date().toISOString()
    }])
  }

  private convertToDatabaseFormat(localData: Record<string, unknown>): Record<string, unknown> {
    // Convert camelCase to snake_case for Supabase canonical column names
    // Only include fields that are actually present and mutable
    const dbData: Record<string, unknown> = {}

    // Map camelCase fields to snake_case canonical column names
    if (localData.accountId !== undefined) dbData.account_id = localData.accountId
    if (localData.projectId !== undefined) dbData.project_id = localData.projectId
    if (localData.transactionId !== undefined) dbData.transaction_id = localData.transactionId
    if (localData.itemId !== undefined) dbData.item_id = localData.itemId
    if (localData.name !== undefined) dbData.name = localData.name
    if (localData.description !== undefined) dbData.description = localData.description
    if (localData.source !== undefined) dbData.source = localData.source
    if (localData.sku !== undefined) dbData.sku = localData.sku
    if (localData.price !== undefined) dbData.price = localData.price
    if (localData.purchasePrice !== undefined) dbData.purchase_price = localData.purchasePrice
    if (localData.projectPrice !== undefined) dbData.project_price = localData.projectPrice
    if (localData.marketValue !== undefined) dbData.market_value = localData.marketValue
    if (localData.paymentMethod !== undefined) dbData.payment_method = localData.paymentMethod
    if (localData.disposition !== undefined) dbData.disposition = localData.disposition
    if (localData.notes !== undefined) dbData.notes = localData.notes
    if (localData.space !== undefined) dbData.space = localData.space
    if (localData.qrKey !== undefined) dbData.qr_key = localData.qrKey
    if (localData.taxRatePct !== undefined) dbData.tax_rate_pct = localData.taxRatePct
    if (localData.taxAmountPurchasePrice !== undefined) dbData.tax_amount_purchase_price = localData.taxAmountPurchasePrice
    if (localData.taxAmountProjectPrice !== undefined) dbData.tax_amount_project_price = localData.taxAmountProjectPrice
    if (localData.bookmark !== undefined) dbData.bookmark = localData.bookmark
    if (localData.inventoryStatus !== undefined) dbData.inventory_status = localData.inventoryStatus
    if (localData.businessInventoryLocation !== undefined) dbData.business_inventory_location = localData.businessInventoryLocation
    if (localData.originTransactionId !== undefined) dbData.origin_transaction_id = localData.originTransactionId
    if (localData.latestTransactionId !== undefined) dbData.latest_transaction_id = localData.latestTransactionId

    // Version and metadata - always update these on resolution
    if (localData.version !== undefined) dbData.version = localData.version
    if (localData.updatedBy !== undefined) {
      dbData.updated_by = localData.updatedBy
    } else if (localData.createdBy !== undefined) {
      dbData.updated_by = localData.createdBy
    }
    dbData.last_updated = new Date().toISOString()

    return dbData
  }

  private serverToLocalItem(serverItem: Record<string, unknown>): Record<string, unknown> {
    // Use item_id (business identifier) as itemId, fallback to id (UUID) if item_id missing
    return {
      itemId: (serverItem.item_id as string) || (serverItem.id as string),
      accountId: serverItem.account_id as string,
      projectId: serverItem.project_id as string | null,
      transactionId: serverItem.transaction_id as string | null,
      name: serverItem.name as string,
      description: serverItem.description as string,
      source: serverItem.source as string,
      sku: serverItem.sku as string,
      price: serverItem.price as string,
      purchasePrice: serverItem.purchase_price as string,
      projectPrice: serverItem.project_price as string,
      marketValue: serverItem.market_value as string,
      paymentMethod: serverItem.payment_method as string,
      disposition: serverItem.disposition as string | null,
      notes: serverItem.notes as string,
      space: serverItem.space as string,
      qrKey: serverItem.qr_key as string,
      bookmark: serverItem.bookmark as boolean,
      dateCreated: serverItem.date_created as string,
      lastUpdated: (serverItem.updated_at || serverItem.last_updated) as string,
      taxRatePct: serverItem.tax_rate_pct as number,
      taxAmountPurchasePrice: serverItem.tax_amount_purchase_price as string,
      taxAmountProjectPrice: serverItem.tax_amount_project_price as string,
      createdBy: serverItem.created_by as string,
      inventoryStatus: serverItem.inventory_status as 'available' | 'allocated' | 'sold',
      businessInventoryLocation: serverItem.business_inventory_location as string,
      originTransactionId: serverItem.origin_transaction_id as string | null,
      latestTransactionId: serverItem.latest_transaction_id as string | null,
      version: (serverItem.version as number) || 1,
      last_synced_at: new Date().toISOString()
    }
  }
}

export const conflictResolver = new ConflictResolver()