import { ConflictItem } from '../types/conflicts'
import { offlineStore, type DBItem, type DBTransaction, type DBProject } from './offlineStore'
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
  'id', // UUID primary key
  'itemId', // Business identifier (item_id), immutable
  'accountId', // Set at creation, shouldn't change
  'projectId', // Can change but handled separately
  'transactionId', // Can change but handled separately
  'qrKey', // Immutable QR code identifier
  'dateCreated', // Creation timestamp
  'createdBy', // Creator user ID
  'createdAt', // Creation timestamp
  'last_synced_at', // Sync metadata
  'originTransactionId', // Immutable lineage field
  'latestTransactionId' // Denormalized, updated separately
] as const

// Mutable fields for transactions that should be compared for conflicts
const MUTABLE_TRANSACTION_FIELDS = [
  'amount',
  'allocatedAmount',
  'categoryId',
  'taxRatePreset',
  'taxRatePct',
  'subtotal',
  'status',
  'notes',
  'itemIds',
  'needsReview',
  'sumItemPurchasePrices',
  'reimbursementType',
  'triggerEvent'
] as const

// Read-only fields for transactions
const READ_ONLY_TRANSACTION_FIELDS = [
  'id', // UUID primary key
  'transactionId', // Business identifier, immutable
  'accountId', // Set at creation, shouldn't change
  'projectId', // Can change but handled separately
  'transactionDate', // Creation timestamp
  'createdBy', // Creator user ID
  'createdAt', // Creation timestamp
  'last_synced_at' // Sync metadata
] as const

// Mutable fields for projects that should be compared for conflicts
const MUTABLE_PROJECT_FIELDS = [
  'name',
  'description',
  'budget',
  'designFee',
  'defaultCategoryId',
  'status',
  'settings',
  'budgetCategories'
] as const

// Read-only fields for projects
const READ_ONLY_PROJECT_FIELDS = [
  'id', // UUID primary key
  'accountId', // Set at creation, shouldn't change
  'clientName', // Set at creation, shouldn't change
  'createdBy', // Creator user ID
  'createdAt', // Creation timestamp
  'updatedAt', // Updated timestamp (but we compare content)
  'last_synced_at' // Sync metadata
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

      // Clear any existing stored conflicts for this project so we only keep the latest snapshot
      await offlineStore.deleteAllConflictsForProject(projectId)

      // Ensure per-account cleanup still happens for legacy entries
      const accountsForProject = new Set<string>()
      for (const localItem of localItems) {
        if (!localItem.accountId) continue
        accountsForProject.add(localItem.accountId)
      }
      if (accountsForProject.size === 0 && serverItems) {
        for (const serverItem of serverItems) {
          if (serverItem.account_id) {
            accountsForProject.add(serverItem.account_id as string)
          }
        }
      }
      for (const accountId of accountsForProject) {
        await offlineStore.deleteConflictsForProject(accountId, projectId)
      }

      // Compare each local item with server version
      // Note: Supabase uses `id` (UUID) as primary key, but `item_id` (TEXT) as the business identifier
      // Local cache uses `itemId` which maps to `item_id` from Supabase
      for (const localItem of localItems) {
        // Skip items that were recently synced (within last 5 seconds) to prevent re-detection after resolution
        if (localItem.last_synced_at) {
          const syncTime = new Date(localItem.last_synced_at).getTime()
          const now = Date.now()
          if (now - syncTime < 5000) {
            // Item was just synced/resolved, skip conflict detection
            continue
          }
        }

        // Match by item_id (business identifier), not id (UUID primary key)
        const serverItem = serverItems.find(item => 
          (item.item_id === localItem.itemId) || (item.id === localItem.itemId)
        )

        if (!serverItem) {
          // Item exists locally but not on server - this is a create operation, not a conflict
          continue
        }

        const conflict = this.compareItems(localItem, serverItem)
        if (conflict) {
          conflicts.push(conflict)
          // Store conflict in IndexedDB for persistence
          if (localItem.accountId) {
            await this.storeConflict(conflict, localItem.accountId, localItem.projectId ?? null, 'item')
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

  async detectTransactionConflicts(accountId: string, projectId?: string | null): Promise<ConflictItem[]> {
    const conflicts: ConflictItem[] = []

    try {
      // Get local transactions
      const allLocalTransactions = await offlineStore.getAllTransactions()
      const localTransactions = projectId
        ? allLocalTransactions.filter(tx => tx.projectId === projectId && tx.accountId === accountId)
        : allLocalTransactions.filter(tx => tx.accountId === accountId)

      // Get server transactions
      let query = supabase
        .from('transactions')
        .select('*')
        .eq('account_id', accountId)
      
      if (projectId) {
        query = query.eq('project_id', projectId)
      }

      const { data: serverTransactions, error } = await query

      if (error) throw error

      // Compare each local transaction with server version
      for (const localTransaction of localTransactions) {
        // Skip transactions that were recently synced
        if (localTransaction.last_synced_at) {
          const syncTime = new Date(localTransaction.last_synced_at).getTime()
          const now = Date.now()
          if (now - syncTime < 5000) {
            continue
          }
        }

        // Match by transaction_id (business identifier)
        const serverTransaction = serverTransactions?.find(tx => 
          tx.transaction_id === localTransaction.transactionId
        )

        if (!serverTransaction) {
          // Transaction exists locally but not on server - this is a create operation, not a conflict
          continue
        }

        const conflict = this.compareTransactions(localTransaction, serverTransaction)
        if (conflict) {
          conflicts.push(conflict)
          // Store conflict in IndexedDB
          await this.storeConflict(conflict, accountId, localTransaction.projectId ?? null, 'transaction')
        }
      }
    } catch (error) {
      console.error('Error detecting transaction conflicts:', error)
    }

    return conflicts
  }

  async detectProjectConflicts(accountId: string): Promise<ConflictItem[]> {
    const conflicts: ConflictItem[] = []

    try {
      // Get local projects
      const localProjects = await offlineStore.getProjects()

      // Get server projects
      const { data: serverProjects, error } = await supabase
        .from('projects')
        .select('*')
        .eq('account_id', accountId)

      if (error) throw error

      // Compare each local project with server version
      for (const localProject of localProjects) {
        // Skip projects that were recently synced
        if (localProject.last_synced_at) {
          const syncTime = new Date(localProject.last_synced_at).getTime()
          const now = Date.now()
          if (now - syncTime < 5000) {
            continue
          }
        }

        // Match by id
        const serverProject = serverProjects?.find(p => p.id === localProject.id)

        if (!serverProject) {
          // Project exists locally but not on server - this is a create operation, not a conflict
          continue
        }

        // Verify accountId matches
        if (serverProject.account_id !== accountId) {
          continue
        }

        const conflict = this.compareProjects(localProject, serverProject)
        if (conflict) {
          conflicts.push(conflict)
          // Store conflict in IndexedDB
          await this.storeConflict(conflict, accountId, localProject.id, 'project')
        }
      }
    } catch (error) {
      console.error('Error detecting project conflicts:', error)
    }

    return conflicts
  }

  private async storeConflict(
    conflict: ConflictItem, 
    accountId: string, 
    projectId: string | null,
    entityType: 'item' | 'transaction' | 'project' = 'item'
  ): Promise<void> {
    try {
      // Store conflict metadata in IndexedDB so UX persists after refresh
      const conflictData: Parameters<typeof offlineStore.saveConflict>[0] = {
        entityType,
        accountId,
        projectId,
        type: conflict.type,
        field: conflict.field || 'unknown',
        local: {
          data: conflict.local.data,
          timestamp: conflict.local.timestamp,
          version: conflict.local.version
        },
        server: {
          data: conflict.server.data,
          timestamp: conflict.server.timestamp,
          version: conflict.server.version
        },
        resolved: false
      }

      // Set entity-specific ID field
      if (entityType === 'item') {
        conflictData.itemId = conflict.id
      } else if (entityType === 'transaction') {
        conflictData.transactionId = conflict.id
      } else if (entityType === 'project') {
        conflictData.projectId = conflict.id
      }

      await offlineStore.saveConflict(conflictData)
    } catch (error) {
      console.error('Failed to store conflict:', error)
    }
  }

  private compareItems(localItem: DBItem, serverItem: Record<string, unknown>): ConflictItem | null {
    // Align column names: convert server snake_case to local camelCase for comparison
    const alignedServerItem = this.alignServerItemToLocal(serverItem)

    // Skip conflict detection if item was recently synced (within last 2 seconds)
    // This prevents immediate re-detection after resolution
    if (localItem.last_synced_at) {
      const syncTime = new Date(localItem.last_synced_at).getTime()
      const now = Date.now()
      if (now - syncTime < 2000) {
        // Item was just synced, skip conflict detection
        return null
      }
    }

    // Check if versions differ significantly
    // Only flag as conflict if versions differ AND content actually differs
    const serverVersion = (alignedServerItem.version as number) || 1
    const versionDiffers = localItem.version !== serverVersion

    // Check timestamps (server is newer) - use last_updated from server
    const localTime = new Date(localItem.lastUpdated).getTime()
    const serverTime = new Date(alignedServerItem.lastUpdated).getTime()
    const timeDiffers = serverTime > localTime + 10000 // 10 second buffer for clock skew and sync delays

    // Only flag version/timestamp conflicts if content also differs
    // This prevents false positives from sync timing issues
    let contentDiffers = false
    for (const field of MUTABLE_ITEM_FIELDS) {
      if (READ_ONLY_ITEM_FIELDS.some(ro => ro.toLowerCase() === field.toLowerCase())) {
        continue
      }
      const localValue = (localItem as Record<string, unknown>)[field]
      const serverValue = (alignedServerItem as Record<string, unknown>)[field]
      if (!this.valuesEqual(localValue, serverValue)) {
        contentDiffers = true
        break
      }
    }

    // Only report version/timestamp conflicts if content actually differs
    if ((versionDiffers || timeDiffers) && contentDiffers) {
      if (versionDiffers) {
        return {
          id: localItem.itemId,
          entityType: 'item',
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
      
      if (timeDiffers) {
        return {
          id: localItem.itemId,
          entityType: 'item',
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
    }

    // Check for content differences in mutable fields only
    // Skip read-only fields and only compare actual mutable content
    for (const field of MUTABLE_ITEM_FIELDS) {
      // Skip if field is in read-only list (case-insensitive check)
      if (READ_ONLY_ITEM_FIELDS.some(ro => ro.toLowerCase() === field.toLowerCase())) {
        continue
      }

      const localValue = (localItem as Record<string, unknown>)[field]
      const serverValue = (alignedServerItem as Record<string, unknown>)[field]

      // Deep comparison for complex objects, simple comparison for primitives
      if (!this.valuesEqual(localValue, serverValue)) {
        return {
          id: localItem.itemId,
          entityType: 'item',
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

  private compareTransactions(localTransaction: DBTransaction, serverTransaction: Record<string, unknown>): ConflictItem | null {
    // Align column names: convert server snake_case to local camelCase for comparison
    const alignedServerTransaction = this.alignServerTransactionToLocal(serverTransaction)

    // Skip conflict detection if transaction was recently synced
    if (localTransaction.last_synced_at) {
      const syncTime = new Date(localTransaction.last_synced_at).getTime()
      const now = Date.now()
      if (now - syncTime < 2000) {
        return null
      }
    }

    // Check if versions differ significantly
    const serverVersion = (alignedServerTransaction.version as number) || 1
    const versionDiffers = localTransaction.version !== serverVersion

    // Check timestamps
    const localTime = new Date(localTransaction.createdAt).getTime()
    const serverTime = new Date(alignedServerTransaction.createdAt).getTime()
    const timeDiffers = serverTime > localTime + 10000 // 10 second buffer

    // Only flag version/timestamp conflicts if content also differs
    let contentDiffers = false
    for (const field of MUTABLE_TRANSACTION_FIELDS) {
      if (READ_ONLY_TRANSACTION_FIELDS.some(ro => ro.toLowerCase() === field.toLowerCase())) {
        continue
      }
      const localValue = (localTransaction as Record<string, unknown>)[field]
      const serverValue = (alignedServerTransaction as Record<string, unknown>)[field]
      if (!this.valuesEqual(localValue, serverValue)) {
        contentDiffers = true
        break
      }
    }

    // Only report version/timestamp conflicts if content actually differs
    if ((versionDiffers || timeDiffers) && contentDiffers) {
      if (versionDiffers) {
        return {
          id: localTransaction.transactionId,
          entityType: 'transaction',
          local: {
            data: localTransaction,
            timestamp: localTransaction.createdAt,
            version: localTransaction.version
          },
          server: {
            data: alignedServerTransaction,
            timestamp: alignedServerTransaction.createdAt,
            version: serverVersion
          },
          field: 'version',
          type: 'version'
        }
      }
      
      if (timeDiffers) {
        return {
          id: localTransaction.transactionId,
          entityType: 'transaction',
          local: {
            data: localTransaction,
            timestamp: localTransaction.createdAt,
            version: localTransaction.version
          },
          server: {
            data: alignedServerTransaction,
            timestamp: alignedServerTransaction.createdAt,
            version: serverVersion
          },
          field: 'timestamp',
          type: 'timestamp'
        }
      }
    }

    // Check for content differences in mutable fields only
    for (const field of MUTABLE_TRANSACTION_FIELDS) {
      if (READ_ONLY_TRANSACTION_FIELDS.some(ro => ro.toLowerCase() === field.toLowerCase())) {
        continue
      }

      const localValue = (localTransaction as Record<string, unknown>)[field]
      const serverValue = (alignedServerTransaction as Record<string, unknown>)[field]

      if (!this.valuesEqual(localValue, serverValue)) {
        return {
          id: localTransaction.transactionId,
          entityType: 'transaction',
          local: {
            data: localTransaction,
            timestamp: localTransaction.createdAt,
            version: localTransaction.version
          },
          server: {
            data: alignedServerTransaction,
            timestamp: alignedServerTransaction.createdAt,
            version: serverVersion
          },
          field,
          type: 'content'
        }
      }
    }

    return null // No conflict
  }

  private compareProjects(localProject: DBProject, serverProject: Record<string, unknown>): ConflictItem | null {
    // Align column names: convert server snake_case to local camelCase for comparison
    const alignedServerProject = this.alignServerProjectToLocal(serverProject)

    // Skip conflict detection if project was recently synced
    if (localProject.last_synced_at) {
      const syncTime = new Date(localProject.last_synced_at).getTime()
      const now = Date.now()
      if (now - syncTime < 2000) {
        return null
      }
    }

    // Check if versions differ significantly
    const serverVersion = (alignedServerProject.version as number) || 1
    const versionDiffers = localProject.version !== serverVersion

    // Check timestamps
    const localTime = new Date(localProject.updatedAt).getTime()
    const serverTime = new Date(alignedServerProject.updatedAt).getTime()
    const timeDiffers = serverTime > localTime + 10000 // 10 second buffer

    // Only flag version/timestamp conflicts if content also differs
    let contentDiffers = false
    for (const field of MUTABLE_PROJECT_FIELDS) {
      if (READ_ONLY_PROJECT_FIELDS.some(ro => ro.toLowerCase() === field.toLowerCase())) {
        continue
      }
      const localValue = (localProject as Record<string, unknown>)[field]
      const serverValue = (alignedServerProject as Record<string, unknown>)[field]
      if (!this.valuesEqual(localValue, serverValue)) {
        contentDiffers = true
        break
      }
    }

    // Only report version/timestamp conflicts if content actually differs
    if ((versionDiffers || timeDiffers) && contentDiffers) {
      if (versionDiffers) {
        return {
          id: localProject.id,
          entityType: 'project',
          local: {
            data: localProject,
            timestamp: localProject.updatedAt,
            version: localProject.version
          },
          server: {
            data: alignedServerProject,
            timestamp: alignedServerProject.updatedAt,
            version: serverVersion
          },
          field: 'version',
          type: 'version'
        }
      }
      
      if (timeDiffers) {
        return {
          id: localProject.id,
          entityType: 'project',
          local: {
            data: localProject,
            timestamp: localProject.updatedAt,
            version: localProject.version
          },
          server: {
            data: alignedServerProject,
            timestamp: alignedServerProject.updatedAt,
            version: serverVersion
          },
          field: 'timestamp',
          type: 'timestamp'
        }
      }
    }

    // Check for content differences in mutable fields only
    for (const field of MUTABLE_PROJECT_FIELDS) {
      if (READ_ONLY_PROJECT_FIELDS.some(ro => ro.toLowerCase() === field.toLowerCase())) {
        continue
      }

      const localValue = (localProject as Record<string, unknown>)[field]
      const serverValue = (alignedServerProject as Record<string, unknown>)[field]

      if (!this.valuesEqual(localValue, serverValue)) {
        return {
          id: localProject.id,
          entityType: 'project',
          local: {
            data: localProject,
            timestamp: localProject.updatedAt,
            version: localProject.version
          },
          server: {
            data: alignedServerProject,
            timestamp: alignedServerProject.updatedAt,
            version: serverVersion
          },
          field,
          type: 'content'
        }
      }
    }

    return null // No conflict
  }

  private alignServerTransactionToLocal(serverTransaction: Record<string, unknown>): DBTransaction {
    return {
      transactionId: (serverTransaction.transaction_id as string) || '',
      accountId: serverTransaction.account_id as string,
      projectId: serverTransaction.project_id as string | null,
      transactionDate: serverTransaction.transaction_date as string,
      source: serverTransaction.source as string,
      transactionType: serverTransaction.transaction_type as string,
      paymentMethod: serverTransaction.payment_method as string,
      amount: serverTransaction.amount as string,
      budgetCategory: serverTransaction.budget_category as string,
      categoryId: serverTransaction.category_id as string,
      notes: serverTransaction.notes as string,
      receiptEmailed: serverTransaction.receipt_emailed as boolean,
      createdAt: serverTransaction.created_at as string,
      createdBy: serverTransaction.created_by as string,
      status: serverTransaction.status as 'pending' | 'completed' | 'canceled',
      reimbursementType: serverTransaction.reimbursement_type as string | null,
      triggerEvent: serverTransaction.trigger_event as string,
      taxRatePreset: serverTransaction.tax_rate_preset as string,
      taxRatePct: serverTransaction.tax_rate_pct as number,
      subtotal: serverTransaction.subtotal as string,
      needsReview: serverTransaction.needs_review as boolean,
      sumItemPurchasePrices: serverTransaction.sum_item_purchase_prices as string,
      itemIds: serverTransaction.item_ids as string[],
      version: (serverTransaction.version as number) || 1
    }
  }

  private alignServerProjectToLocal(serverProject: Record<string, unknown>): DBProject {
    return {
      id: serverProject.id as string,
      name: serverProject.name as string,
      description: serverProject.description as string,
      clientName: serverProject.client_name as string,
      budget: serverProject.budget as number,
      designFee: serverProject.design_fee as number,
      defaultCategoryId: serverProject.default_category_id as string,
      mainImageUrl: serverProject.main_image_url as string,
      createdAt: serverProject.created_at as string,
      updatedAt: serverProject.updated_at as string,
      createdBy: serverProject.created_by as string,
      version: (serverProject.version as number) || 1
    }
  }

  private alignServerItemToLocal(serverItem: Record<string, unknown>): DBItem {
    // Convert snake_case server fields to camelCase for local comparison
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
      lastUpdated: (serverItem.last_updated || serverItem.updated_at) as string,
      taxRatePct: serverItem.tax_rate_pct as number,
      taxAmountPurchasePrice: serverItem.tax_amount_purchase_price as string,
      taxAmountProjectPrice: serverItem.tax_amount_project_price as string,
      createdBy: serverItem.created_by as string,
      inventoryStatus: serverItem.inventory_status as string,
      businessInventoryLocation: serverItem.business_inventory_location as string,
      originTransactionId: serverItem.origin_transaction_id as string | null,
      latestTransactionId: serverItem.latest_transaction_id as string | null,
      version: (serverItem.version as number) || 1
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
      const objA = a as Record<string, unknown>
      const objB = b as Record<string, unknown>
      const keysA = Object.keys(objA)
      const keysB = Object.keys(objB)
      if (keysA.length !== keysB.length) return false
      return keysA.every(key => this.valuesEqual(objA[key], objB[key]))
    }

    // Primitive comparison
    return a === b
  }
}

export const conflictDetector = new ConflictDetector()