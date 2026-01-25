import type { ItemImage, TransactionImage } from '@/types'

interface DBItem {
  itemId: string
  accountId?: string
  projectId?: string | null
  transactionId?: string | null
  previousProjectTransactionId?: string | null
  previousProjectId?: string | null
  name?: string
  description: string
  source: string
  sku: string
  price?: string
  purchasePrice?: string
  projectPrice?: string
  marketValue?: string
  paymentMethod: string
  disposition?: string | null
  notes?: string
  space?: string
  spaceId?: string | null
  qrKey: string
  bookmark: boolean
  dateCreated: string
  lastUpdated: string
  createdAt?: string
  images?: ItemImage[]
  taxRatePct?: number
  taxAmountPurchasePrice?: string
  taxAmountProjectPrice?: string
  createdBy?: string
  inventoryStatus?: 'available' | 'allocated' | 'sold'
  businessInventoryLocation?: string
  originTransactionId?: string | null
  latestTransactionId?: string | null
  version: number // For conflict resolution
  last_synced_at?: string // Track when this was last synced
}

interface DBTransaction {
  transactionId: string
  accountId: string
  projectId?: string | null
  projectName?: string | null
  transactionDate: string
  source: string
  transactionType: string
  paymentMethod: string
  amount: string
  budgetCategory?: string
  categoryId?: string
  notes?: string
  transactionImages?: TransactionImage[] // Legacy field for backward compatibility
  receiptImages?: TransactionImage[]
  otherImages?: TransactionImage[]
  receiptEmailed: boolean
  createdAt: string
  createdBy: string
  status?: 'pending' | 'completed' | 'canceled'
  reimbursementType?: string | null
  triggerEvent?: string
  taxRatePreset?: string | null
  taxRatePct?: number | null
  subtotal?: string | null
  needsReview?: boolean
  sumItemPurchasePrices?: string
  itemIds?: string[]
  pendingItemIds?: string[]
  pendingItemIdsAction?: 'add' | 'remove'
  pendingItemIdsUpdatedAt?: string
  version: number
  last_synced_at?: string
}

interface DBProject {
  id: string
  accountId: string
  name: string
  description: string
  clientName: string
  budget?: number
  designFee?: number
  budgetCategories?: Record<string, number>
  defaultCategoryId?: string | null
  mainImageUrl?: string
  createdAt: string
  updatedAt: string
  createdBy: string
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
  itemCount?: number
  transactionCount?: number
  totalValue?: number
  version: number
  last_synced_at?: string
}

interface DBOperation {
  id: string
  type: string
  timestamp: string
  retryCount: number
  lastError?: string
  accountId: string
  updatedBy: string
  version: number
  data: Record<string, unknown>
}

interface DBContextRecord {
  id: string
  userId: string
  accountId: string
  updatedAt: string
}

interface DBCacheEntry {
  key: string
  data: unknown
  timestamp: string
  expiresAt?: string
}

interface DBMediaEntry {
  id: string
  itemId: string
  accountId: string
  filename: string
  mimeType: string
  size: number
  blob: Blob
  uploadedAt: string
  expiresAt?: string // For cleanup of temporary uploads
}

interface DBMediaUploadQueueEntry {
  id: string
  mediaId: string
  accountId: string
  itemId: string
  metadata?: {
    isPrimary?: boolean
    caption?: string
  }
  queuedAt: string
  retryCount: number
  lastError?: string
}

interface DBConflict {
  id: string
  entityType: 'item' | 'transaction' | 'project'
  itemId?: string // For item conflicts
  transactionId?: string // For transaction conflicts
  projectId?: string // For project conflicts (also used for item conflicts to scope them)
  accountId: string
  type: 'version' | 'timestamp' | 'content'
  field?: string
  local: {
    data: unknown
    timestamp: string
    version: number
  }
  server: {
    data: unknown
    timestamp: string
    version: number
  }
  createdAt: string
  resolved?: boolean
  resolution?: 'local' | 'server' | 'merge'
}

interface DBBudgetCategory {
  id: string
  accountId: string
  name: string
  slug: string
  isArchived: boolean
  metadata?: Record<string, any> | null
  createdAt: string
  updatedAt: string
  cachedAt: string // When this was cached
}

interface DBTaxPreset {
  id: string
  name: string
  rate: number
}

interface DBTaxPresetsCache {
  accountId: string
  presets: DBTaxPreset[]
  cachedAt: string // When this was cached
}

interface DBVendorDefaultsCache {
  accountId: string
  slots: Array<string | null> // Raw string slots (exactly 10)
  cachedAt: string // When this was cached
}

class OfflineStore {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  private readonly dbName = 'ledger-offline'
  private readonly dbVersion = 9 // Increment when schema changes
  private resettingDatabase = false

  async init(): Promise<void> {
    if (this.db) {
      return
    }

    if (this.initPromise) {
      return this.initPromise
    }

    if (typeof indexedDB === 'undefined') {
      console.warn('IndexedDB is not available in this environment; offline cache disabled.')
      return
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => {
        this.initPromise = null
        reject(request.error)
      }
      request.onblocked = () => {
        console.warn('[offlineStore] Database upgrade blocked by another open tab. Please close other Ledger tabs and reload.')
      }
      request.onsuccess = () => {
        this.db = request.result
        this.db.onversionchange = () => {
          console.warn('[offlineStore] Database version change detected. Closing existing connection.')
          this.db?.close()
          this.db = null
        }
        this.initPromise = null
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const oldVersion = event.oldVersion
        const upgradeTransaction = (event.target as IDBOpenDBRequest).transaction

        // Run migrations based on old version
        this.runMigrations(db, oldVersion, upgradeTransaction)
      }
    })

    return this.initPromise
  }

  /**
   * Wait for the database to be initialized if it's not already.
   * Returns immediately if already initialized.
   */
  async waitForInit(): Promise<void> {
    if (this.db) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    // If not initialized and no promise exists, try to initialize
    return this.init()
  }

  /**
   * Check if the database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null
  }

  /**
   * Reset the IndexedDB database by deleting and re-initializing it.
   * This is used when migrations failed to create required stores.
   */
  private async resetDatabase(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      console.warn('[offlineStore] IndexedDB not available; cannot reset database.')
      return
    }

    if (this.resettingDatabase) {
      // Another reset is already in progress; wait for it to finish
      await this.initPromise
      return
    }

    this.resettingDatabase = true

    try {
      if (this.db) {
        this.db.close()
        this.db = null
      }

      await new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(this.dbName)
        deleteRequest.onsuccess = () => resolve()
        deleteRequest.onerror = () => {
          console.error('[offlineStore] Failed to delete IndexedDB database:', deleteRequest.error)
          reject(deleteRequest.error ?? new Error('Failed to delete database'))
        }
        deleteRequest.onblocked = () => {
          console.warn('[offlineStore] Database deletion blocked. Close other tabs that have Ledger open and reload.')
        }
      })

      this.initPromise = null
      await this.init()
    } finally {
      this.resettingDatabase = false
    }
  }

  /**
   * Ensure a given object store exists. If it does not, reset the database
   * so migrations can recreate missing stores.
   */
  private async ensureStoreInitialized(storeName: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    if (this.db.objectStoreNames.contains(storeName)) {
      return true
    }

    console.warn(`[offlineStore] ${storeName} store missing. Resetting offline database to re-run migrations.`)
    await this.resetDatabase()

    if (!this.db) {
      console.error('[offlineStore] Database reset completed but connection is not available.')
      return false
    }

    const hasStore = this.db.objectStoreNames.contains(storeName)
    if (!hasStore) {
      console.error(`[offlineStore] ${storeName} store still missing after reset. Offline metadata caching disabled for this store.`)
    }
    return hasStore
  }

  private runMigrations(db: IDBDatabase, oldVersion: number, transaction: IDBTransaction | null): void {
    console.log(`Running IndexedDB migrations from version ${oldVersion} to ${this.dbVersion}`)

    // Migration 1: Initial schema
    if (oldVersion < 1) {
      // Items store
      if (!db.objectStoreNames.contains('items')) {
        const itemsStore = db.createObjectStore('items', { keyPath: 'itemId' })
        itemsStore.createIndex('projectId', 'projectId', { unique: false })
        itemsStore.createIndex('lastUpdated', 'lastUpdated', { unique: false })
      }

      // Transactions store
      if (!db.objectStoreNames.contains('transactions')) {
        const transactionsStore = db.createObjectStore('transactions', { keyPath: 'transactionId' })
        transactionsStore.createIndex('projectId', 'projectId', { unique: false })
        transactionsStore.createIndex('transactionDate', 'transactionDate', { unique: false })
      }

      // Projects store
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' })
      }
    }

    // Migration 2: Add operations and cache stores, plus accountId index on items
    if (oldVersion < 2) {
      // Operations store for offline queue
      if (!db.objectStoreNames.contains('operations')) {
        const operationsStore = db.createObjectStore('operations', { keyPath: 'id' })
        operationsStore.createIndex('accountId', 'accountId', { unique: false })
        operationsStore.createIndex('timestamp', 'timestamp', { unique: false })
        operationsStore.createIndex('type', 'type', { unique: false })
      }

        // Cache store for API responses
        if (!db.objectStoreNames.contains('cache')) {
          const cacheStore = db.createObjectStore('cache', { keyPath: 'key' })
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false })
          cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false })
        }

        // Conflicts store for unresolved conflicts
        if (!db.objectStoreNames.contains('conflicts')) {
          const conflictsStore = db.createObjectStore('conflicts', { keyPath: 'id' })
          conflictsStore.createIndex('itemId', 'itemId', { unique: false })
          conflictsStore.createIndex('accountId', 'accountId', { unique: false })
          conflictsStore.createIndex('resolved', 'resolved', { unique: false })
          conflictsStore.createIndex('createdAt', 'createdAt', { unique: false })
        }

        // Media store for offline image/blob storage
        if (!db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', { keyPath: 'id' })
          mediaStore.createIndex('itemId', 'itemId', { unique: false })
          mediaStore.createIndex('accountId', 'accountId', { unique: false })
          mediaStore.createIndex('uploadedAt', 'uploadedAt', { unique: false })
          mediaStore.createIndex('expiresAt', 'expiresAt', { unique: false })
        }

      // Add accountId index to items store if it doesn't exist
      if (db.objectStoreNames.contains('items') && transaction) {
        try {
          const itemsStore = transaction.objectStore('items')
          if (itemsStore && !itemsStore.indexNames.contains('accountId')) {
            itemsStore.createIndex('accountId', 'accountId', { unique: false })
          }
        } catch (error) {
          console.warn('Failed to add accountId index to items store during migration:', error)
        }
      }
    }

    // Migration 3: Context store for auth/account metadata
    if (oldVersion < 3) {
      if (!db.objectStoreNames.contains('context')) {
        db.createObjectStore('context', { keyPath: 'id' })
      }
    }

    // Migration 4: Ensure operations are indexed for per-account ordering
    if (oldVersion < 4) {
      if (db.objectStoreNames.contains('operations') && transaction) {
        try {
          const operationsStore = transaction.objectStore('operations')
          if (!operationsStore.indexNames.contains('accountId_timestamp')) {
            operationsStore.createIndex('accountId_timestamp', ['accountId', 'timestamp'], { unique: false })
          }
        } catch (error) {
          console.warn('Failed to add accountId_timestamp index to operations store during migration:', error)
        }
      }
    }

    // Migration 5: Add media upload queue store
    if (oldVersion < 5) {
      if (!db.objectStoreNames.contains('mediaUploadQueue')) {
        const queueStore = db.createObjectStore('mediaUploadQueue', { keyPath: 'id' })
        queueStore.createIndex('mediaId', 'mediaId', { unique: false })
        queueStore.createIndex('accountId', 'accountId', { unique: false })
        queueStore.createIndex('itemId', 'itemId', { unique: false })
        queueStore.createIndex('queuedAt', 'queuedAt', { unique: false })
      }
    }

    // Migration 6: Add budget categories and tax presets stores for offline metadata caching
    if (oldVersion < 6) {
      // Budget categories store
      if (!db.objectStoreNames.contains('budgetCategories')) {
        const categoriesStore = db.createObjectStore('budgetCategories', { keyPath: 'id' })
        categoriesStore.createIndex('accountId', 'accountId', { unique: false })
        categoriesStore.createIndex('cachedAt', 'cachedAt', { unique: false })
      }

      // Tax presets store (one entry per account)
      if (!db.objectStoreNames.contains('taxPresets')) {
        const presetsStore = db.createObjectStore('taxPresets', { keyPath: 'accountId' })
        presetsStore.createIndex('cachedAt', 'cachedAt', { unique: false })
      }
    }

    // Migration 7: Add entityType discriminator to conflicts store
    if (oldVersion < 7) {
      if (db.objectStoreNames.contains('conflicts') && transaction) {
        try {
          const conflictsStore = transaction.objectStore('conflicts')
          
          // Add indexes for transaction and project conflicts
          if (!conflictsStore.indexNames.contains('transactionId')) {
            conflictsStore.createIndex('transactionId', 'transactionId', { unique: false })
          }
          if (!conflictsStore.indexNames.contains('entityType')) {
            conflictsStore.createIndex('entityType', 'entityType', { unique: false })
          }
          if (!conflictsStore.indexNames.contains('entityType_accountId')) {
            conflictsStore.createIndex('entityType_accountId', ['entityType', 'accountId'], { unique: false })
          }
          
          // Migrate existing conflicts to have entityType = 'item' (default for legacy conflicts)
          // This will be done lazily when conflicts are accessed
        } catch (error) {
          console.warn('Failed to add entityType indexes to conflicts store during migration:', error)
        }
      }
    }

    // Migration 8: Ensure budgetCategories and taxPresets stores exist
    // This migration ensures these stores exist even if migration 6 was skipped
    if (oldVersion < 8) {
      // Budget categories store
      if (!db.objectStoreNames.contains('budgetCategories')) {
        const categoriesStore = db.createObjectStore('budgetCategories', { keyPath: 'id' })
        categoriesStore.createIndex('accountId', 'accountId', { unique: false })
        categoriesStore.createIndex('cachedAt', 'cachedAt', { unique: false })
      } else if (transaction) {
        // Store exists, ensure indexes are present
        try {
          const categoriesStore = transaction.objectStore('budgetCategories')
          if (!categoriesStore.indexNames.contains('accountId')) {
            categoriesStore.createIndex('accountId', 'accountId', { unique: false })
          }
          if (!categoriesStore.indexNames.contains('cachedAt')) {
            categoriesStore.createIndex('cachedAt', 'cachedAt', { unique: false })
          }
        } catch (error) {
          console.warn('Failed to add indexes to budgetCategories store during migration:', error)
        }
      }

      // Tax presets store (one entry per account)
      if (!db.objectStoreNames.contains('taxPresets')) {
        const presetsStore = db.createObjectStore('taxPresets', { keyPath: 'accountId' })
        presetsStore.createIndex('cachedAt', 'cachedAt', { unique: false })
      } else if (transaction) {
        // Store exists, ensure indexes are present
        try {
          const presetsStore = transaction.objectStore('taxPresets')
          if (!presetsStore.indexNames.contains('cachedAt')) {
            presetsStore.createIndex('cachedAt', 'cachedAt', { unique: false })
          }
        } catch (error) {
          console.warn('Failed to add indexes to taxPresets store during migration:', error)
        }
      }
    }

    // Migration 9: Add vendor defaults store for offline caching
    if (oldVersion < 9) {
      if (!db.objectStoreNames.contains('vendorDefaults')) {
        const vendorDefaultsStore = db.createObjectStore('vendorDefaults', { keyPath: 'accountId' })
        vendorDefaultsStore.createIndex('cachedAt', 'cachedAt', { unique: false })
      }
    }
  }

  private getConflictKey(accountId: string, entityId: string, entityType: 'item' | 'transaction' | 'project', field?: string, type?: string): string {
    const safeAccount = accountId || 'unknown-account'
    const safeEntity = entityId || 'unknown-entity'
    const safeField = field || 'unknown'
    const safeType = type || 'content'
    return `conflict:${entityType}:${safeAccount}:${safeEntity}:${safeType}:${safeField}`
  }

  async deleteConflictsForItems(accountId: string, itemIds: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!accountId || itemIds.length === 0) {
      return
    }

    const itemSet = new Set(itemIds.filter(Boolean))
    if (itemSet.size === 0) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const accountIndex = store.index('accountId')
      const request = accountIndex.openCursor(IDBKeyRange.only(accountId))

      request.onerror = () => reject(request.error)
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          return
        }

        const value = cursor.value as DBConflict
        if (value.entityType === 'item' && value.itemId && itemSet.has(value.itemId)) {
          cursor.delete()
        }

        cursor.continue()
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteConflictsForTransactions(accountId: string, transactionIds: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!accountId || transactionIds.length === 0) {
      return
    }

    const transactionSet = new Set(transactionIds.filter(Boolean))
    if (transactionSet.size === 0) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const accountIndex = store.index('accountId')
      const request = accountIndex.openCursor(IDBKeyRange.only(accountId))

      request.onerror = () => reject(request.error)
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          return
        }

        const value = cursor.value as DBConflict
        if (value.entityType === 'transaction' && value.transactionId && transactionSet.has(value.transactionId)) {
          cursor.delete()
        }

        cursor.continue()
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteConflictsForProjects(accountId: string, projectIds: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!accountId || projectIds.length === 0) {
      return
    }

    const projectSet = new Set(projectIds.filter(Boolean))
    if (projectSet.size === 0) {
      return
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const accountIndex = store.index('accountId')
      const request = accountIndex.openCursor(IDBKeyRange.only(accountId))

      request.onerror = () => reject(request.error)
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          return
        }

        const value = cursor.value as DBConflict
        if (value.entityType === 'project' && value.projectId && projectSet.has(value.projectId)) {
          cursor.delete()
        }

        cursor.continue()
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteConflictsForProject(accountId: string, projectId: string | null): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!accountId) {
      return
    }

    const normalizedProjectId = projectId ?? null

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const accountIndex = store.index('accountId')
      const request = accountIndex.openCursor(IDBKeyRange.only(accountId))

      request.onerror = () => reject(request.error)
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          return
        }

        const value = cursor.value as DBConflict
        const storedProjectId = value.projectId ?? null
        const matchesProject =
          normalizedProjectId === null
            ? storedProjectId === null || storedProjectId === undefined
            : storedProjectId === normalizedProjectId

        // Delete conflicts for items in this project OR project-level conflicts
        if (matchesProject && (value.entityType === 'item' || value.entityType === 'project')) {
          cursor.delete()
        }

        cursor.continue()
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteAllConflictsForProject(projectId: string | null): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const normalizedProjectId = projectId ?? null

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const request = store.openCursor()

      request.onerror = () => reject(request.error)
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (!cursor) {
          return
        }

        const value = cursor.value as DBConflict
        const storedProjectId = value.projectId ?? null
        const matchesProject =
          normalizedProjectId === null
            ? storedProjectId === null || storedProjectId === undefined
            : storedProjectId === normalizedProjectId

        // Delete conflicts for items in this project OR project-level conflicts
        if (matchesProject && (value.entityType === 'item' || value.entityType === 'project')) {
          cursor.delete()
        }

        cursor.continue()
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Items CRUD
  async getItems(projectId: string): Promise<DBItem[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['items'], 'readonly')
      const store = transaction.objectStore('items')
      const index = store.index('projectId')
      const request = index.getAll(projectId)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async saveItems(items: DBItem[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['items'], 'readwrite')
    const store = transaction.objectStore('items')

    for (const item of items) {
      // Validate itemId is present and valid (required for IndexedDB keyPath)
      if (!item.itemId || typeof item.itemId !== 'string' || item.itemId.trim() === '') {
        throw new Error(`Cannot save item: missing or invalid itemId. Item: ${JSON.stringify(item, null, 2)}`)
      }
      
      // Ensure version exists and increment it
      if (!item.version) {
        item.version = 1
      }
      // Set last synced timestamp
      item.last_synced_at = new Date().toISOString()
      store.put(item)
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async replaceItemsForProject(
    accountId: string,
    projectId: string,
    items: DBItem[],
    options?: { keepItemIds?: Set<string> }
  ): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized')
    if (!projectId) {
      return []
    }

    const keepIds = new Set<string>()
    if (options?.keepItemIds) {
      options.keepItemIds.forEach(id => {
        if (id) keepIds.add(id)
      })
    }
    items.forEach(item => {
      if (item.itemId) {
        keepIds.add(item.itemId)
      }
    })

    const existing = await this.getItems(projectId)
    const removedIds: string[] = []
    for (const record of existing) {
      if (record.accountId && record.accountId !== accountId) {
        continue
      }
      const id = record.itemId
      if (id && !keepIds.has(id)) {
        removedIds.push(id)
      }
    }

    if (removedIds.length > 0) {
      for (const id of removedIds) {
        await this.deleteItem(id)
      }
    }

    if (items.length > 0) {
      await this.saveItems(items)
    }

    return removedIds
  }

  // Transactions CRUD
  async getTransactions(projectId: string): Promise<DBTransaction[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['transactions'], 'readonly')
      const store = transaction.objectStore('transactions')
      const index = store.index('projectId')
      const request = index.getAll(projectId)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async saveTransactions(transactions: DBTransaction[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['transactions'], 'readwrite')
    const store = transaction.objectStore('transactions')

    for (const tx of transactions) {
      // Ensure version exists and increment it
      if (!tx.version) {
        tx.version = 1
      }
      // Set last synced timestamp
      tx.last_synced_at = new Date().toISOString()
      store.put(tx)
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async replaceTransactionsForProject(
    accountId: string,
    projectId: string,
    transactions: DBTransaction[],
    options?: { keepTransactionIds?: Set<string> }
  ): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized')
    if (!projectId) {
      return []
    }

    const keepIds = new Set<string>()
    if (options?.keepTransactionIds) {
      options.keepTransactionIds.forEach(id => {
        if (id) keepIds.add(id)
      })
    }
    transactions.forEach(tx => {
      if (tx.transactionId) {
        keepIds.add(tx.transactionId)
      }
    })

    const existing = await this.getTransactions(projectId)
    const removedIds: string[] = []
    for (const record of existing) {
      if (record.accountId && record.accountId !== accountId) {
        continue
      }
      const id = record.transactionId
      if (id && !keepIds.has(id)) {
        removedIds.push(id)
      }
    }

    if (removedIds.length > 0) {
      for (const id of removedIds) {
        await this.deleteTransaction(id)
      }
    }

    if (transactions.length > 0) {
      await this.saveTransactions(transactions)
    }

    return removedIds
  }

  // Projects CRUD
  async getProjects(): Promise<DBProject[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['projects'], 'readonly')
      const store = transaction.objectStore('projects')
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async saveProjects(projects: DBProject[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['projects'], 'readwrite')
    const store = transaction.objectStore('projects')

    for (const project of projects) {
      // Ensure version exists and increment it
      if (!project.version) {
        project.version = 1
      }
      // Set last synced timestamp
      project.last_synced_at = new Date().toISOString()
      store.put(project)
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getProjectById(projectId: string): Promise<DBProject | null> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['projects'], 'readonly')
      const store = transaction.objectStore('projects')
      const request = store.get(projectId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['projects'], 'readwrite')
      const store = transaction.objectStore('projects')
      const request = store.delete(projectId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Operations CRUD
  async getOperations(accountId?: string): Promise<DBOperation[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['operations'], 'readonly')
      const store = transaction.objectStore('operations')

      if (accountId) {
        const useCompoundIndex = store.indexNames.contains('accountId_timestamp')
        if (useCompoundIndex) {
          const index = store.index('accountId_timestamp')
          const lowerBound: [string, string] = [accountId, '']
          const upperBound: [string, string] = [accountId, '\uffff']
          const range = IDBKeyRange.bound(lowerBound, upperBound)
          const results: DBOperation[] = []
          const cursorRequest = index.openCursor(range)
          cursorRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
            if (cursor) {
              results.push(cursor.value as DBOperation)
              cursor.continue()
            } else {
              resolve(results)
            }
          }
          cursorRequest.onerror = () => reject(cursorRequest.error)
          return
        }

        const index = store.index('accountId')
        const request = index.getAll(accountId)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        return
      }

      const request = store.getAll()
      request.onsuccess = () => {
        const records = request.result ?? []
        // Ensure deterministic ordering for mixed-account reads
        records.sort((a, b) => {
          if (a.accountId === b.accountId) {
            return a.timestamp.localeCompare(b.timestamp)
          }
          return (a.accountId ?? '').localeCompare(b.accountId ?? '')
        })
        resolve(records)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async saveOperations(operations: DBOperation[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['operations'], 'readwrite')
    const store = transaction.objectStore('operations')

    for (const operation of operations) {
      store.put(operation)
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async replaceOperationsForAccount(accountId: string, operations: DBOperation[]): Promise<void> {
    if (!accountId) {
      throw new Error('replaceOperationsForAccount requires an accountId')
    }

    await this.clearOperations(accountId)

    if (operations.length === 0) {
      return
    }

    await this.saveOperations(operations)
  }

  async deleteOperation(operationId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['operations'], 'readwrite')
      const store = transaction.objectStore('operations')
      const request = store.delete(operationId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clearOperations(accountId?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['operations'], 'readwrite')
    const store = transaction.objectStore('operations')

    if (accountId) {
      // Clear operations for specific account
      const index = store.index('accountId')
      const request = index.openCursor(IDBKeyRange.only(accountId))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
    } else {
      // Clear all operations
      store.clear()
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Context persistence
  async getContext(): Promise<DBContextRecord | null> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['context'], 'readonly')
      const store = transaction.objectStore('context')
      const request = store.get('active-context')

      request.onsuccess = () => {
        resolve(request.result || null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async saveContext(context: Omit<DBContextRecord, 'id'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const record: DBContextRecord = {
      id: 'active-context',
      ...context
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['context'], 'readwrite')
      const store = transaction.objectStore('context')
      const request = store.put(record)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clearContext(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['context'], 'readwrite')
      const store = transaction.objectStore('context')
      const request = store.delete('active-context')

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Cache methods
  async getCachedData(key: string): Promise<unknown | null> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly')
      const store = transaction.objectStore('cache')
      const request = store.get(key)

      request.onsuccess = () => {
        const entry: DBCacheEntry | undefined = request.result
        if (!entry) {
          resolve(null)
          return
        }

        // Check if expired
        if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
          // Expired, remove it
          this.deleteCachedData(key).catch(console.warn)
          resolve(null)
          return
        }

        resolve(entry.data)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async setCachedData(key: string, data: unknown, ttlMs?: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const entry: DBCacheEntry = {
      key,
      data,
      timestamp: new Date().toISOString(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite')
      const store = transaction.objectStore('cache')
      const request = store.put(entry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteCachedData(key: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite')
      const store = transaction.objectStore('cache')
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clearExpiredCache(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['cache'], 'readwrite')
    const store = transaction.objectStore('cache')
    const index = store.index('expiresAt')
    const range = IDBKeyRange.upperBound(new Date().toISOString())

    const request = index.openCursor(range)

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Conflict methods
  private normalizeConflictRecord(conflict: DBConflict): boolean {
    let updated = false

    if (!conflict.entityType) {
      conflict.entityType = 'item'
      updated = true
    }

    if (conflict.entityType === 'item') {
      const derivedItemId = this.extractConflictEntityId(conflict, ['itemId', 'item_id'])
      if (derivedItemId && conflict.itemId !== derivedItemId) {
        conflict.itemId = derivedItemId
        updated = true
      } else if (typeof conflict.itemId === 'string') {
        const trimmed = conflict.itemId.trim()
        if (trimmed !== conflict.itemId) {
          conflict.itemId = trimmed
          updated = true
        }
      }
    } else if (conflict.entityType === 'transaction') {
      const derivedTransactionId = this.extractConflictEntityId(conflict, ['transactionId', 'transaction_id'])
      if (derivedTransactionId && conflict.transactionId !== derivedTransactionId) {
        conflict.transactionId = derivedTransactionId
        updated = true
      }
    } else if (conflict.entityType === 'project') {
      const derivedProjectId = this.extractConflictEntityId(conflict, ['projectId', 'project_id'])
      if (derivedProjectId && conflict.projectId !== derivedProjectId) {
        conflict.projectId = derivedProjectId
        updated = true
      }
    }

    return updated
  }

  private extractConflictEntityId(conflict: DBConflict, keys: string[]): string | null {
    for (const key of keys) {
      const value = (conflict as unknown as Record<string, unknown>)[key]
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
    }

    const payloads = [conflict.local?.data, conflict.server?.data]
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') {
        continue
      }

      for (const key of keys) {
        const candidate = (payload as Record<string, unknown>)[key]
        if (typeof candidate === 'string') {
          const trimmedCandidate = candidate.trim()
          if (trimmedCandidate.length > 0) {
            return trimmedCandidate
          }
        }
      }
    }

    return null
  }

  async saveConflict(conflict: Omit<DBConflict, 'id' | 'createdAt'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Determine entity ID based on entityType
    const entityId = conflict.entityType === 'item' 
      ? conflict.itemId || ''
      : conflict.entityType === 'transaction'
      ? conflict.transactionId || ''
      : conflict.projectId || ''
    
    const conflictKey = this.getConflictKey(conflict.accountId, entityId, conflict.entityType, conflict.field, conflict.type)
    const transaction = this.db.transaction(['conflicts'], 'readwrite')
    const store = transaction.objectStore('conflicts')

    return new Promise((resolve, reject) => {
      const getRequest = store.get(conflictKey)

      getRequest.onerror = () => reject(getRequest.error)
      getRequest.onsuccess = () => {
        const existing = getRequest.result as DBConflict | undefined
        const dbConflict: DBConflict = {
          ...existing,
          ...conflict,
          id: conflictKey,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          resolved: conflict.resolved ?? existing?.resolved ?? false,
          resolution: conflict.resolution ?? existing?.resolution
        }

        const putRequest = store.put(dbConflict)
        putRequest.onerror = () => reject(putRequest.error)

        // Clean up duplicates based on entityType
        let index: IDBIndex | null = null
        let entityIdToCheck: string | undefined
        
        if (conflict.entityType === 'item' && conflict.itemId) {
          index = store.index('itemId')
          entityIdToCheck = conflict.itemId
        } else if (conflict.entityType === 'transaction' && conflict.transactionId) {
          index = store.index('transactionId')
          entityIdToCheck = conflict.transactionId
        } else if (conflict.entityType === 'project' && conflict.projectId) {
          // For projects, use accountId + projectId to find duplicates
          const entityTypeAccountIndex = store.index('entityType_accountId')
          const range = IDBKeyRange.bound(
            ['project', conflict.accountId],
            ['project', conflict.accountId + '\uffff']
          )
          const cursorRequest = entityTypeAccountIndex.openCursor(range)
          cursorRequest.onerror = () => reject(cursorRequest.error)
          cursorRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
            if (!cursor) {
              transaction.oncomplete = () => resolve()
              return
            }

            const value = cursor.value as DBConflict
            const sameAccount = value.accountId === conflict.accountId
            const sameProject = value.projectId === conflict.projectId
            const sameField = (value.field || 'unknown') === (dbConflict.field || 'unknown')
            const sameType = value.type === dbConflict.type
            const isDuplicate = value.id !== conflictKey && sameAccount && sameProject && sameField && sameType && !value.resolved

            if (isDuplicate) {
              cursor.delete()
            }

            cursor.continue()
          }
          return
        }

        if (index && entityIdToCheck) {
          const cursorRequest = index.openCursor(IDBKeyRange.only(entityIdToCheck))
          cursorRequest.onerror = () => reject(cursorRequest.error)
          cursorRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
            if (!cursor) {
              transaction.oncomplete = () => resolve()
              return
            }

            const value = cursor.value as DBConflict
            const sameAccount = value.accountId === conflict.accountId
            const sameField = (value.field || 'unknown') === (dbConflict.field || 'unknown')
            const sameType = value.type === dbConflict.type
            const isDuplicate = value.id !== conflictKey && sameAccount && sameField && sameType && !value.resolved

            if (isDuplicate) {
              cursor.delete()
            }

            cursor.continue()
          }
        } else {
          transaction.oncomplete = () => resolve()
        }
      }

      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getConflicts(accountId?: string, resolved?: boolean): Promise<DBConflict[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite') // Use readwrite to migrate legacy conflicts
      const store = transaction.objectStore('conflicts')

      let request: IDBRequest
      if (accountId && resolved !== undefined) {
        // Get by account and resolved status
        const index = store.index('accountId')
        request = index.openCursor(IDBKeyRange.only(accountId))

        const results: DBConflict[] = []
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
          if (cursor) {
            const conflict = cursor.value as DBConflict
            const updated = this.normalizeConflictRecord(conflict)
            if (updated) {
              cursor.update(conflict)
            }
            if (conflict.resolved === resolved) {
              results.push(conflict)
            }
            cursor.continue()
          } else {
            resolve(results)
          }
        }
      } else if (accountId) {
        // Get by account only
        const index = store.index('accountId')
        request = index.openCursor(IDBKeyRange.only(accountId))
        
        const results: DBConflict[] = []
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
          if (cursor) {
            const conflict = cursor.value as DBConflict
            const updated = this.normalizeConflictRecord(conflict)
            if (updated) {
              cursor.update(conflict)
            }
            results.push(conflict)
            cursor.continue()
          } else {
            resolve(results)
          }
        }
      } else {
        // Get all
        request = store.openCursor()
        const results: DBConflict[] = []
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
          if (cursor) {
            const conflict = cursor.value as DBConflict
            const updated = this.normalizeConflictRecord(conflict)
            if (updated) {
              cursor.update(conflict)
            }
            results.push(conflict)
            cursor.continue()
          } else {
            resolve(results)
          }
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async resolveConflict(conflictId: string, resolution: 'local' | 'server' | 'merge'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')

      const getRequest = store.get(conflictId)
      getRequest.onsuccess = () => {
        const conflict = getRequest.result as DBConflict
        if (conflict) {
          conflict.resolved = true
          conflict.resolution = resolution
          store.put(conflict)
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteConflict(conflictId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const request = store.delete(conflictId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Media methods
  async saveMedia(mediaEntry: Omit<DBMediaEntry, 'id' | 'uploadedAt'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized')

    // Check storage quota before saving
    const quotaStatus = await this.checkStorageQuota()
    if (quotaStatus.usageRatio > 0.9) {
      throw new Error('Storage quota nearly full. Please free up space before uploading more media.')
    }

    const id = `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const entry: DBMediaEntry = {
      ...mediaEntry,
      id,
      uploadedAt: new Date().toISOString()
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['media'], 'readwrite')
      const store = transaction.objectStore('media')
      const request = store.put(entry)

      request.onsuccess = () => resolve(id)
      request.onerror = () => reject(request.error)
    })
  }

  async getMedia(mediaId: string): Promise<DBMediaEntry | null> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['media'], 'readonly')
      const store = transaction.objectStore('media')
      const request = store.get(mediaId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async getMediaForItem(itemId: string): Promise<DBMediaEntry[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['media'], 'readonly')
      const store = transaction.objectStore('media')
      const index = store.index('itemId')
      const request = index.getAll(itemId)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteMedia(mediaId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['media'], 'readwrite')
      const store = transaction.objectStore('media')
      const request = store.delete(mediaId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async cleanupExpiredMedia(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['media'], 'readwrite')
      const store = transaction.objectStore('media')
      const index = store.index('expiresAt')
      const range = IDBKeyRange.upperBound(new Date().toISOString())

      let deletedCount = 0
      const request = index.openCursor(range)

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          cursor.delete()
          deletedCount++
          cursor.continue()
        } else {
          resolve(deletedCount)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async checkStorageQuota(): Promise<{ usageBytes: number; quotaBytes: number; usageRatio: number }> {
    if (!this.db) throw new Error('Database not initialized')

    try {
      // Estimate storage usage by querying all media entries
      const mediaEntries = await new Promise<DBMediaEntry[]>((resolve, reject) => {
        const transaction = this.db!.transaction(['media'], 'readonly')
        const store = transaction.objectStore('media')
        const request = store.getAll()

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      const usageBytes = mediaEntries.reduce((total, entry) => total + entry.size, 0)

      // Estimate quota (most browsers allow ~50MB for IndexedDB)
      const estimatedQuotaBytes = 50 * 1024 * 1024 // 50MB
      const usageRatio = usageBytes / estimatedQuotaBytes

      return {
        usageBytes,
        quotaBytes: estimatedQuotaBytes,
        usageRatio
      }
    } catch (error) {
      console.warn('Failed to check storage quota:', error)
      return {
        usageBytes: 0,
        quotaBytes: 50 * 1024 * 1024,
        usageRatio: 0
      }
    }
  }

  // Enhanced CRUD methods
  async getAllItems(): Promise<DBItem[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['items'], 'readonly')
      const store = transaction.objectStore('items')
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getItemById(itemId: string): Promise<DBItem | null> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['items'], 'readonly')
      const store = transaction.objectStore('items')
      const request = store.get(itemId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async upsertItem(item: DBItem): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['items'], 'readwrite')
    const store = transaction.objectStore('items')

    // Don't blindly reset version/last_synced_at - preserve existing values unless explicitly updating
    const existing = await this.getItemById(item.itemId)
    if (existing) {
      // Merge with existing data, preserving version unless it's being explicitly updated
      item.version = item.version ?? existing.version
      item.last_synced_at = item.last_synced_at ?? existing.last_synced_at
    } else {
      item.version = item.version ?? 1
      item.last_synced_at = item.last_synced_at ?? new Date().toISOString()
    }

    store.put(item)

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteItem(itemId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['items'], 'readwrite')
      const store = transaction.objectStore('items')
      const request = store.delete(itemId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Similar methods for transactions
  async getAllTransactions(): Promise<DBTransaction[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['transactions'], 'readonly')
      const store = transaction.objectStore('transactions')
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getTransactionById(transactionId: string): Promise<DBTransaction | null> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['transactions'], 'readonly')
      const store = transaction.objectStore('transactions')
      const request = store.get(transactionId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async upsertTransaction(transaction: DBTransaction): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const dbTransaction = this.db!.transaction(['transactions'], 'readwrite')
      const store = dbTransaction.objectStore('transactions')
      const request = store.get(transaction.transactionId)

      request.onsuccess = () => {
        const existing = request.result as DBTransaction | undefined
        // Don't blindly reset version/last_synced_at - preserve existing values unless explicitly updating
        if (existing) {
          // Merge with existing data, preserving version unless it's being explicitly updated
          transaction.version = transaction.version ?? existing.version
          transaction.last_synced_at = transaction.last_synced_at ?? existing.last_synced_at
        } else {
          transaction.version = transaction.version ?? 1
          transaction.last_synced_at = transaction.last_synced_at ?? new Date().toISOString()
        }

        try {
          store.put(transaction)
        } catch (error) {
          reject(error)
        }
      }

      request.onerror = () => reject(request.error)
      dbTransaction.oncomplete = () => resolve()
      dbTransaction.onerror = () => reject(dbTransaction.error)
    })
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['transactions'], 'readwrite')
      const store = transaction.objectStore('transactions')
      const request = store.delete(transactionId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Media upload queue methods
  async addMediaUploadToQueue(entry: Omit<DBMediaUploadQueueEntry, 'id' | 'queuedAt' | 'retryCount'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized')
    const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const queueEntry: DBMediaUploadQueueEntry = {
      ...entry,
      id,
      queuedAt: new Date().toISOString(),
      retryCount: 0
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['mediaUploadQueue'], 'readwrite')
      const store = transaction.objectStore('mediaUploadQueue')
      const request = store.put(queueEntry)

      request.onsuccess = () => resolve(id)
      request.onerror = () => reject(request.error)
    })
  }

  async getMediaUploadQueue(accountId?: string): Promise<DBMediaUploadQueueEntry[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['mediaUploadQueue'], 'readonly')
      const store = transaction.objectStore('mediaUploadQueue')
      const request = accountId
        ? store.index('accountId').getAll(accountId)
        : store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async removeMediaUploadFromQueue(queueId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['mediaUploadQueue'], 'readwrite')
      const store = transaction.objectStore('mediaUploadQueue')
      const request = store.delete(queueId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async updateMediaUploadQueueEntry(queueId: string, updates: Partial<DBMediaUploadQueueEntry>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['mediaUploadQueue'], 'readwrite')
      const store = transaction.objectStore('mediaUploadQueue')
      const getRequest = store.get(queueId)

      getRequest.onsuccess = () => {
        const entry = getRequest.result
        if (entry) {
          Object.assign(entry, updates)
          store.put(entry)
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Budget Categories CRUD
  async saveBudgetCategories(_accountId: string, categories: Omit<DBBudgetCategory, 'cachedAt'>[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('budgetCategories'))) {
      return
    }

    const transaction = this.db.transaction(['budgetCategories'], 'readwrite')
    const store = transaction.objectStore('budgetCategories')
    const cachedAt = new Date().toISOString()

    for (const category of categories) {
      const dbCategory: DBBudgetCategory = {
        ...category,
        cachedAt
      }
      store.put(dbCategory)
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getBudgetCategories(accountId: string): Promise<DBBudgetCategory[]> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('budgetCategories'))) {
      return []
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['budgetCategories'], 'readonly')
      const store = transaction.objectStore('budgetCategories')
      const index = store.index('accountId')
      const request = index.getAll(accountId)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getBudgetCategoryById(accountId: string, categoryId: string): Promise<DBBudgetCategory | null> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('budgetCategories'))) {
      return null
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['budgetCategories'], 'readonly')
      const store = transaction.objectStore('budgetCategories')
      const request = store.get(categoryId)

      request.onsuccess = () => {
        const category = request.result as DBBudgetCategory | undefined
        // Verify it belongs to the account
        if (category && category.accountId === accountId) {
          resolve(category)
        } else {
          resolve(null)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clearBudgetCategories(accountId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('budgetCategories'))) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['budgetCategories'], 'readwrite')
      const store = transaction.objectStore('budgetCategories')
      const index = store.index('accountId')
      const request = index.openCursor(IDBKeyRange.only(accountId))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Tax Presets CRUD
  async saveTaxPresets(accountId: string, presets: DBTaxPreset[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('taxPresets'))) {
      return
    }

    const transaction = this.db.transaction(['taxPresets'], 'readwrite')
    const store = transaction.objectStore('taxPresets')
    const cachedAt = new Date().toISOString()

    const cacheEntry: DBTaxPresetsCache = {
      accountId,
      presets,
      cachedAt
    }
    store.put(cacheEntry)

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getTaxPresets(accountId: string): Promise<DBTaxPreset[] | null> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('taxPresets'))) {
      return null
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['taxPresets'], 'readonly')
      const store = transaction.objectStore('taxPresets')
      const request = store.get(accountId)

      request.onsuccess = () => {
        const cache = request.result as DBTaxPresetsCache | undefined
        resolve(cache?.presets ?? null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getTaxPresetById(accountId: string, presetId: string): Promise<DBTaxPreset | null> {
    const presets = await this.getTaxPresets(accountId)
    if (!presets) return null
    return presets.find(p => p.id === presetId) || null
  }

  async clearTaxPresets(accountId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('taxPresets'))) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['taxPresets'], 'readwrite')
      const store = transaction.objectStore('taxPresets')
      const request = store.delete(accountId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Vendor Defaults CRUD
  async saveVendorDefaults(accountId: string, slots: Array<string | null>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('vendorDefaults'))) {
      return
    }

    // Validate slots
    if (!Array.isArray(slots) || slots.length !== 10) {
      throw new Error('Vendor defaults must be an array of exactly 10 slots')
    }

    const transaction = this.db.transaction(['vendorDefaults'], 'readwrite')
    const store = transaction.objectStore('vendorDefaults')
    const cachedAt = new Date().toISOString()

    const cacheEntry: DBVendorDefaultsCache = {
      accountId,
      slots,
      cachedAt
    }
    store.put(cacheEntry)

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getVendorDefaults(accountId: string): Promise<Array<string | null> | null> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('vendorDefaults'))) {
      return null
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vendorDefaults'], 'readonly')
      const store = transaction.objectStore('vendorDefaults')
      const request = store.get(accountId)

      request.onsuccess = () => {
        const cache = request.result as DBVendorDefaultsCache | undefined
        resolve(cache?.slots ?? null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clearVendorDefaults(accountId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (!(await this.ensureStoreInitialized('vendorDefaults'))) {
      return
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vendorDefaults'], 'readwrite')
      const store = transaction.objectStore('vendorDefaults')
      const request = store.delete(accountId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Utility methods
  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['items', 'transactions', 'projects', 'operations', 'cache', 'conflicts', 'media', 'mediaUploadQueue', 'budgetCategories', 'taxPresets', 'vendorDefaults'], 'readwrite')

    transaction.objectStore('items').clear()
    transaction.objectStore('transactions').clear()
    transaction.objectStore('projects').clear()
    transaction.objectStore('operations').clear()
    transaction.objectStore('cache').clear()
    transaction.objectStore('conflicts').clear()
    transaction.objectStore('media').clear()
    if (transaction.objectStore('mediaUploadQueue')) {
      transaction.objectStore('mediaUploadQueue').clear()
    }
    if (transaction.objectStore('budgetCategories')) {
      transaction.objectStore('budgetCategories').clear()
    }
    if (transaction.objectStore('taxPresets')) {
      transaction.objectStore('taxPresets').clear()
    }
    if (transaction.objectStore('vendorDefaults')) {
      transaction.objectStore('vendorDefaults').clear()
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }
}

export const offlineStore = new OfflineStore()

export function mapItemToDBItem(item: any): DBItem {
  const purchasePrice = item.purchasePrice ?? item.purchase_price
  const projectPrice = item.projectPrice ?? item.project_price
  const marketValue = item.marketValue ?? item.market_value
  const taxRatePct = item.taxRatePct ?? item.tax_rate_pct
  const taxAmountPurchasePrice = item.taxAmountPurchasePrice ?? item.tax_amount_purchase_price
  const taxAmountProjectPrice = item.taxAmountProjectPrice ?? item.tax_amount_project_price
  return {
    itemId: item.itemId || item.id || item.item_id,
    accountId: item.accountId || item.account_id,
    projectId: item.projectId || item.project_id || null,
    transactionId: item.transactionId || item.transaction_id || null,
    previousProjectTransactionId: item.previousProjectTransactionId ?? null,
    previousProjectId: item.previousProjectId ?? null,
    name: item.name,
    description: item.description ?? '',
    source: item.source ?? '',
    sku: item.sku ?? '',
    price: item.price !== undefined && item.price !== null ? String(item.price) : undefined,
    purchasePrice: purchasePrice !== undefined && purchasePrice !== null ? String(purchasePrice) : undefined,
    projectPrice: projectPrice !== undefined && projectPrice !== null ? String(projectPrice) : undefined,
    marketValue: marketValue !== undefined && marketValue !== null ? String(marketValue) : undefined,
    paymentMethod: item.paymentMethod || item.payment_method || '',
    disposition: item.disposition ?? null,
    notes: item.notes ?? '',
    space: item.space ?? '',
    spaceId: item.spaceId || item.space_id || null,
    qrKey: item.qrKey || item.qr_key || '',
    bookmark: item.bookmark ?? false,
    dateCreated: item.dateCreated || item.date_created || new Date().toISOString(),
    lastUpdated: item.lastUpdated || item.last_updated || new Date().toISOString(),
    createdAt: item.createdAt ? (item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt) : (item.created_at || new Date().toISOString()),
    images: item.images ?? [],
    taxRatePct,
    taxAmountPurchasePrice,
    taxAmountProjectPrice,
    createdBy: item.createdBy || item.created_by,
    inventoryStatus: item.inventoryStatus || item.inventory_status,
    businessInventoryLocation: item.businessInventoryLocation || item.business_inventory_location,
    originTransactionId: item.originTransactionId || item.origin_transaction_id || null,
    latestTransactionId: item.latestTransactionId || item.latest_transaction_id || null,
    version: item.version ?? 1,
    last_synced_at: new Date().toISOString()
  }
}

export function mapSupabaseItemToOfflineRecord(item: any): DBItem {
  return mapItemToDBItem(item)
}

export function mapProjectToDBProject(project: any): DBProject {
  return {
    id: project.id,
    accountId: project.accountId || project.account_id,
    name: project.name,
    description: project.description ?? '',
    clientName: project.clientName || project.client_name || '',
    budget: project.budget,
    designFee: project.designFee ?? project.design_fee,
    budgetCategories: project.budgetCategories ?? project.budget_categories ?? {},
    defaultCategoryId: project.defaultCategoryId ?? project.default_category_id ?? null,
    mainImageUrl: project.mainImageUrl || project.main_image_url,
    createdAt: project.createdAt ? (project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt) : (project.created_at || new Date().toISOString()),
    updatedAt: project.updatedAt ? (project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt) : (project.updated_at || new Date().toISOString()),
    createdBy: project.createdBy || project.created_by || '',
    settings: project.settings ?? {},
    metadata: project.metadata ?? {},
    itemCount: project.itemCount ?? project.item_count ?? 0,
    transactionCount: project.transactionCount ?? project.transaction_count ?? 0,
    totalValue: project.totalValue ?? project.total_value ?? 0,
    version: project.version ?? 1,
    last_synced_at: new Date().toISOString()
  }
}

export type { DBItem, DBTransaction, DBProject, DBOperation, DBContextRecord, DBMediaUploadQueueEntry, DBBudgetCategory, DBTaxPreset, DBTaxPresetsCache, DBVendorDefaultsCache }