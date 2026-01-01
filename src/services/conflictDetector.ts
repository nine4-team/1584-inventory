import { ConflictItem } from '../types/conflicts'
import { offlineStore, type DBItem } from './offlineStore'
import { supabase } from './supabase'

// Mutable fields that should be compared for conflicts
const MUTABLE_ITEM_FIELDS = [
  'name',
  'description',
  'source',
  'sku',
  'price',
  'purchase_price',
  'project_price',
  'market_value',
  'payment_method',
  'disposition',
  'notes',
  'space',
  'tax_rate_pct',
  'tax_amount_purchase_price',
  'tax_amount_project_price',
  'bookmark',
  'inventory_status',
  'business_inventory_location'
] as const

// Read-only fields that should be ignored during conflict detection
const READ_ONLY_ITEM_FIELDS = [
  'id',
  'item_id',
  'account_id',
  'project_id',
  'transaction_id',
  'qr_key',
  'date_created',
  'created_by',
  'created_at',
  'last_synced_at'
] as const

export class ConflictDetector {
  async detectConflicts(projectId: string): Promise<ConflictItem[]> {
    const conflicts: ConflictItem[] = []

    try {
      // Get local items
      const localItems = await offlineStore.getItems(projectId)

      // Get server items
      const { data: serverItems, error } = await supabase
        .from('items')
        .select('*')
        .eq('project_id', projectId)

      if (error) throw error

      // Compare each local item with server version
      for (const localItem of localItems) {
        const serverItem = serverItems.find(item => item.id === localItem.itemId)

        if (!serverItem) {
          // Item exists locally but not on server - this is a create operation, not a conflict
          continue
        }

        const conflict = this.compareItems(localItem, serverItem)
        if (conflict) {
          conflicts.push(conflict)
          // Store conflict in IndexedDB for persistence
          if (localItem.accountId) {
            await this.storeConflict(conflict, localItem.accountId)
          } else {
            console.warn('Skipping conflict persistence due to missing accountId', {
              itemId: localItem.itemId
            })
          }
        }
      }
    } catch (error) {
      console.error('Error detecting conflicts:', error)
    }

    return conflicts
  }

  private async storeConflict(conflict: ConflictItem, accountId: string): Promise<void> {
    try {
      await offlineStore.saveConflict({
        itemId: conflict.id,
        accountId,
        type: conflict.type,
        field: conflict.field,
        local: conflict.local,
        server: conflict.server,
        resolved: false
      })
    } catch (error) {
      console.error('Failed to store conflict:', error)
    }
  }

  private compareItems(localItem: DBItem, serverItem: Record<string, unknown>): ConflictItem | null {
    // Align column names: convert server snake_case to local camelCase for comparison
    const alignedServerItem = this.alignServerItemToLocal(serverItem)

    // Check if versions differ significantly
    const serverVersion = (alignedServerItem.version as number) || 1
    if (localItem.version !== serverVersion) {
      return {
        id: localItem.itemId,
        local: {
          data: localItem,
          timestamp: localItem.lastUpdated,
          version: localItem.version
        },
        server: {
          data: alignedServerItem,
          timestamp: alignedServerItem.lastUpdated,
          version: serverVersion
        },
        field: 'version',
        type: 'version'
      }
    }

    // Check timestamps (server is newer) - use last_updated from server
    const localTime = new Date(localItem.lastUpdated).getTime()
    const serverTime = new Date(alignedServerItem.lastUpdated).getTime()

    if (serverTime > localTime + 5000) { // 5 second buffer for clock skew
      return {
        id: localItem.itemId,
        local: {
          data: localItem,
          timestamp: localItem.lastUpdated,
          version: localItem.version
        },
        server: {
          data: alignedServerItem,
          timestamp: alignedServerItem.lastUpdated,
          version: serverVersion
        },
        field: 'timestamp',
        type: 'timestamp'
      }
    }

    // Check for content differences in mutable fields only
    for (const field of MUTABLE_ITEM_FIELDS) {
      const localValue = (localItem as Record<string, unknown>)[field]
      const serverValue = (alignedServerItem as Record<string, unknown>)[field]

      // Deep comparison for complex objects, simple comparison for primitives
      if (!this.valuesEqual(localValue, serverValue)) {
        return {
          id: localItem.itemId,
          local: {
            data: localItem,
            timestamp: localItem.lastUpdated,
            version: localItem.version
          },
          server: {
            data: alignedServerItem,
            timestamp: alignedServerItem.lastUpdated,
            version: serverVersion
          },
          field,
          type: 'content'
        }
      }
    }

    return null // No conflict
  }

  private alignServerItemToLocal(serverItem: Record<string, unknown>): DBItem {
    // Convert snake_case server fields to camelCase for local comparison
    return {
      itemId: serverItem.id as string,
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
      lastUpdated: serverItem.last_updated || serverItem.updated_at as string,
      taxRatePct: serverItem.tax_rate_pct as number,
      taxAmountPurchasePrice: serverItem.tax_amount_purchase_price as string,
      taxAmountProjectPrice: serverItem.tax_amount_project_price as string,
      createdBy: serverItem.created_by as string,
      inventoryStatus: serverItem.inventory_status as string,
      businessInventoryLocation: serverItem.business_inventory_location as string,
      version: serverItem.version as number || 1
    }
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    // Handle null/undefined
    if (a == null && b == null) return true
    if (a == null || b == null) return false

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((val, idx) => this.valuesEqual(val, b[idx]))
    }

    // Handle objects
    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a)
      const keysB = Object.keys(b)
      if (keysA.length !== keysB.length) return false
      return keysA.every(key => this.valuesEqual((a as any)[key], (b as any)[key]))
    }

    // Primitive comparison
    return a === b
  }
}

export const conflictDetector = new ConflictDetector()