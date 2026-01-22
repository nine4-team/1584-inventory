import { ConflictItem, Resolution, ConflictResolution } from '../types/conflicts'
import { offlineStore, type DBItem } from './offlineStore'
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
        // Update local store to match server exactly
        const serverItem = this.serverToLocalItem(conflict.server.data, conflict.id)
        serverItem.version = conflict.server.version
        serverItem.lastUpdated = (conflict.server.data as any).last_updated || (conflict.server.data as any).lastUpdated || new Date().toISOString()
        serverItem.last_synced_at = new Date().toISOString()
        await offlineStore.saveItems([serverItem])
        
        // Delete all conflicts for this item after resolution
        if ((conflict.local.data as any).accountId) {
          await offlineStore.deleteConflictsForItems((conflict.local.data as any).accountId, [conflict.id])
        }
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
    const { error, data: updatedItem } = await supabase
      .from('items')
      .update(dbData)
      .eq('item_id', conflict.id)
      .select()
      .single()

    if (error) {
      console.error('Failed to update item in Supabase:', error)
      throw error
    }

    // Update local store with the resolved data, using server's version and timestamp
    // This ensures local and server are in sync after resolution
    const normalizedItem = this.buildLocalItem(finalData, conflict)
    
    // Use server's version and timestamp to prevent immediate re-detection
    if (updatedItem) {
      normalizedItem.version = (updatedItem.version as number) || Math.max(conflict.local.version, conflict.server.version) + 1
      normalizedItem.lastUpdated = (updatedItem.last_updated || updatedItem.updated_at) as string || new Date().toISOString()
    } else {
      normalizedItem.version = Math.max(conflict.local.version, conflict.server.version) + 1
      normalizedItem.lastUpdated = new Date().toISOString()
    }
    normalizedItem.last_synced_at = new Date().toISOString()

    await offlineStore.saveItems([normalizedItem])
    
    // Delete all conflicts for this item after resolution
    if ((conflict.local.data as any).accountId) {
      await offlineStore.deleteConflictsForItems((conflict.local.data as any).accountId, [conflict.id])
    }
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

  private serverToLocalItem(serverData: Record<string, unknown>, itemId: string): DBItem {
    // Convert snake_case server fields to camelCase for local storage
    // Use item_id (business identifier) as itemId, fallback to provided itemId if item_id missing
    const serverItem = serverData as any
    const now = new Date().toISOString()
    
    const resolvedItemId = (serverItem.item_id as string) || (serverItem.id as string) || itemId
    if (!resolvedItemId) {
      throw new Error(`Cannot convert server item to local format: missing itemId. Provided itemId: ${itemId}`)
    }
    
    return {
      itemId: resolvedItemId,
      accountId: serverItem.account_id as string,
      projectId: serverItem.project_id as string | null ?? null,
      transactionId: serverItem.transaction_id as string | null ?? null,
      name: serverItem.name as string | undefined,
      description: serverItem.description as string ?? '',
      source: serverItem.source as string ?? '',
      sku: serverItem.sku as string ?? '',
      price: serverItem.price as string | undefined,
      purchasePrice: serverItem.purchase_price as string | undefined,
      projectPrice: serverItem.project_price as string | undefined,
      marketValue: serverItem.market_value as string | undefined,
      paymentMethod: serverItem.payment_method as string ?? '',
      disposition: serverItem.disposition as string | null ?? null,
      notes: serverItem.notes as string | undefined,
      space: serverItem.space as string | undefined,
      qrKey: serverItem.qr_key as string ?? '',
      bookmark: serverItem.bookmark as boolean ?? false,
      dateCreated: serverItem.date_created as string || now,
      lastUpdated: (serverItem.last_updated || serverItem.updated_at) as string || now,
      images: Array.isArray(serverItem.images) ? serverItem.images : [],
      taxRatePct:
        serverItem.tax_rate_pct !== undefined && serverItem.tax_rate_pct !== null
          ? Number(serverItem.tax_rate_pct)
          : undefined,
      taxAmountPurchasePrice: serverItem.tax_amount_purchase_price as string | undefined,
      taxAmountProjectPrice: serverItem.tax_amount_project_price as string | undefined,
      createdBy: serverItem.created_by as string | undefined,
      inventoryStatus: serverItem.inventory_status as 'available' | 'allocated' | 'sold' | undefined,
      businessInventoryLocation: serverItem.business_inventory_location as string | undefined,
      originTransactionId: serverItem.origin_transaction_id as string | null ?? null,
      latestTransactionId: serverItem.latest_transaction_id as string | null ?? null,
      version: (serverItem.version as number) || 1,
      last_synced_at: new Date().toISOString()
    }
  }

  private buildLocalItem(resolvedData: Record<string, unknown>, conflict: ConflictItem): DBItem {
    const localSource = conflict.local.data || {}
    const serverSource = conflict.server.data || {}

    // Helper to convert snake_case to camelCase key
    const toSnakeCase = (camelCase: string): string => {
      return camelCase.replace(/([A-Z])/g, '_$1').toLowerCase()
    }

    const pickValue = (key: string, fallback?: unknown): any => {
      // Check camelCase first (local format)
      if (resolvedData[key] !== undefined) return resolvedData[key]
      if ((localSource as any)[key] !== undefined) return (localSource as any)[key]
      if ((serverSource as any)[key] !== undefined) return (serverSource as any)[key]
      
      // Check snake_case (server format) - only for resolvedData and serverSource
      const snakeKey = toSnakeCase(key)
      if (resolvedData[snakeKey] !== undefined) return resolvedData[snakeKey]
      if ((serverSource as any)[snakeKey] !== undefined) return (serverSource as any)[snakeKey]
      
      // Special case for itemId: also check 'id' field
      if (key === 'itemId') {
        if (resolvedData.id !== undefined) return resolvedData.id
        if ((serverSource as any).id !== undefined) return (serverSource as any).id
      }
      
      return fallback
    }

    const now = new Date().toISOString()

    const itemId = (pickValue('itemId') as string) || conflict.id
    if (!itemId) {
      throw new Error(`Cannot build local item: missing itemId. Conflict ID: ${conflict.id}`)
    }

    return {
      itemId,
      accountId: pickValue('accountId'),
      projectId: pickValue('projectId') ?? null,
      transactionId: pickValue('transactionId') ?? null,
      name: pickValue('name'),
      description: pickValue('description') ?? '',
      source: pickValue('source') ?? '',
      sku: pickValue('sku') ?? '',
      price: pickValue('price'),
      purchasePrice: pickValue('purchasePrice'),
      projectPrice: pickValue('projectPrice'),
      marketValue: pickValue('marketValue'),
      paymentMethod: pickValue('paymentMethod') ?? '',
      disposition: pickValue('disposition') ?? null,
      notes: pickValue('notes'),
      space: pickValue('space'),
      qrKey: pickValue('qrKey') ?? '',
      bookmark: pickValue('bookmark') ?? false,
      dateCreated: pickValue('dateCreated') ?? now,
      lastUpdated: pickValue('lastUpdated') ?? now,
      images: pickValue('images') ?? [],
      taxRatePct: pickValue('taxRatePct'),
      taxAmountPurchasePrice: pickValue('taxAmountPurchasePrice'),
      taxAmountProjectPrice: pickValue('taxAmountProjectPrice'),
      createdBy: pickValue('createdBy'),
      inventoryStatus: pickValue('inventoryStatus'),
      businessInventoryLocation: pickValue('businessInventoryLocation'),
      originTransactionId: pickValue('originTransactionId') ?? null,
      latestTransactionId: pickValue('latestTransactionId') ?? null,
      version: (pickValue('version') as number) || conflict.local.version || conflict.server.version || 1,
      last_synced_at: now
    }
  }
}

export const conflictResolver = new ConflictResolver()