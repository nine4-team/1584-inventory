import type { ItemImage } from '@/types'

interface DBItem {
  itemId: string
  accountId?: string
  projectId?: string | null
  transactionId?: string | null
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
  qrKey: string
  bookmark: boolean
  dateCreated: string
  lastUpdated: string
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
  transactionDate: string
  source: string
  transactionType: string
  paymentMethod: string
  amount: string
  budgetCategory?: string
  categoryId?: string
  notes?: string
  receiptEmailed: boolean
  createdAt: string
  createdBy: string
  status?: 'pending' | 'completed' | 'canceled'
  reimbursementType?: string | null
  triggerEvent?: string
  taxRatePreset?: string
  taxRatePct?: number
  subtotal?: string
  needsReview?: boolean
  sumItemPurchasePrices?: string
  itemIds?: string[]
  version: number
  last_synced_at?: string
}

interface DBProject {
  id: string
  name: string
  description: string
  clientName: string
  budget?: number
  designFee?: number
  defaultCategoryId?: string
  mainImageUrl?: string
  createdAt: string
  updatedAt: string
  createdBy: string
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

interface DBConflict {
  id: string
  itemId: string
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

class OfflineStore {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  private readonly dbName = 'ledger-offline'
  private readonly dbVersion = 4 // Increment when schema changes

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
      request.onsuccess = () => {
        this.db = request.result
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
  async saveConflict(conflict: Omit<DBConflict, 'id' | 'createdAt'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const dbConflict: DBConflict = {
      ...conflict,
      id: `conflict-${conflict.itemId}-${Date.now()}`,
      createdAt: new Date().toISOString()
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readwrite')
      const store = transaction.objectStore('conflicts')
      const request = store.put(dbConflict)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getConflicts(accountId?: string, resolved?: boolean): Promise<DBConflict[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conflicts'], 'readonly')
      const store = transaction.objectStore('conflicts')

      let request: IDBRequest
      if (accountId && resolved !== undefined) {
        // Get by account and resolved status
        const index = store.index('accountId')
        request = index.openCursor(IDBKeyRange.only(accountId))

        const results: DBConflict[] = []
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor) {
            const conflict = cursor.value as DBConflict
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
        request = index.getAll(accountId)
        request.onsuccess = () => resolve(request.result)
      } else {
        // Get all
        request = store.getAll()
        request.onsuccess = () => resolve(request.result)
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
    const dbTransaction = this.db.transaction(['transactions'], 'readwrite')
    const store = dbTransaction.objectStore('transactions')

    // Don't blindly reset version/last_synced_at - preserve existing values unless explicitly updating
    const existing = await this.getTransactionById(transaction.transactionId)
    if (existing) {
      // Merge with existing data, preserving version unless it's being explicitly updated
      transaction.version = transaction.version ?? existing.version
      transaction.last_synced_at = transaction.last_synced_at ?? existing.last_synced_at
    } else {
      transaction.version = transaction.version ?? 1
      transaction.last_synced_at = transaction.last_synced_at ?? new Date().toISOString()
    }

    store.put(transaction)

    return new Promise((resolve, reject) => {
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

  // Utility methods
  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['items', 'transactions', 'projects', 'operations', 'cache', 'conflicts', 'media'], 'readwrite')

    transaction.objectStore('items').clear()
    transaction.objectStore('transactions').clear()
    transaction.objectStore('projects').clear()
    transaction.objectStore('operations').clear()
    transaction.objectStore('cache').clear()
    transaction.objectStore('conflicts').clear()
    transaction.objectStore('media').clear()

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }
}

export const offlineStore = new OfflineStore()
export type { DBItem, DBTransaction, DBProject, DBOperation, DBContextRecord }