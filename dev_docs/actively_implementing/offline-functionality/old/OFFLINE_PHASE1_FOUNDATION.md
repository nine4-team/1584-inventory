# Offline Functionality - Phase 1: Foundation Implementation

## Overview
Implement basic offline data storage and read operations. This phase focuses on IndexedDB setup, network state detection, and read-only offline mode.

## Goals
- Store app data locally using IndexedDB
- Detect online/offline network state
- Serve cached data when offline
- Maintain existing online functionality

## Implementation Scope
**DO NOT implement in this phase:**
- Operation queuing
- Background sync
- Conflict resolution
- Write operations while offline

## Step 1: IndexedDB Store Setup

### Create `/src/services/offlineStore.ts`

```typescript
interface DBItem {
  id: string
  project_id: string
  name: string
  description?: string
  quantity: number
  unit_cost: number
  created_at: string
  updated_at: string
  version: number // For future conflict resolution
}

interface DBTransaction {
  id: string
  project_id: string
  vendor_id?: string
  date: string
  amount: number
  description?: string
  created_at: string
  updated_at: string
  version: number
}

interface DBProject {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
  version: number
}

class OfflineStore {
  private db: IDBDatabase | null = null
  private readonly dbName = 'ledger-offline'
  private readonly dbVersion = 1

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Items store
        if (!db.objectStoreNames.contains('items')) {
          const itemsStore = db.createObjectStore('items', { keyPath: 'id' })
          itemsStore.createIndex('project_id', 'project_id', { unique: false })
          itemsStore.createIndex('updated_at', 'updated_at', { unique: false })
        }

        // Transactions store
        if (!db.objectStoreNames.contains('transactions')) {
          const transactionsStore = db.createObjectStore('transactions', { keyPath: 'id' })
          transactionsStore.createIndex('project_id', 'project_id', { unique: false })
          transactionsStore.createIndex('date', 'date', { unique: false })
        }

        // Projects store
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' })
        }
      }
    })
  }

  // Items CRUD
  async getItems(projectId: string): Promise<DBItem[]> {
    if (!this.db) throw new Error('Database not initialized')
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['items'], 'readonly')
      const store = transaction.objectStore('items')
      const index = store.index('project_id')
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
      const index = store.index('project_id')
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
      store.put(project)
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Utility methods
  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const transaction = this.db.transaction(['items', 'transactions', 'projects'], 'readwrite')

    transaction.objectStore('items').clear()
    transaction.objectStore('transactions').clear()
    transaction.objectStore('projects').clear()

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }
}

export const offlineStore = new OfflineStore()
export type { DBItem, DBTransaction, DBProject }
```

### Create `/src/services/offlineItemService.ts`

```typescript
import { offlineStore, type DBItem } from './offlineStore'
import { supabase } from '../lib/supabase'
import type { Item } from '../types/item'

export class OfflineItemService {
  private isOnline = navigator.onLine

  constructor() {
    // Listen for network changes
    window.addEventListener('online', () => this.isOnline = true)
    window.addEventListener('offline', () => this.isOnline = false)
  }

  async getItems(projectId: string): Promise<Item[]> {
    try {
      if (this.isOnline) {
        // Fetch from Supabase and cache locally
        const { data, error } = await supabase
          .from('items')
          .select('*')
          .eq('project_id', projectId)
          .order('updated_at', { ascending: false })

        if (error) throw error

        // Convert to DB format and cache
        const dbItems: DBItem[] = data.map(item => ({
          ...item,
          version: 1 // Initial version
        }))
        await offlineStore.saveItems(dbItems)

        return data
      } else {
        // Serve from cache
        const cached = await offlineStore.getItems(projectId)
        // Convert back to Item format
        return cached.map(dbItem => ({
          id: dbItem.id,
          project_id: dbItem.project_id,
          name: dbItem.name,
          description: dbItem.description,
          quantity: dbItem.quantity,
          unit_cost: dbItem.unit_cost,
          created_at: dbItem.created_at,
          updated_at: dbItem.updated_at
        }))
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      // Fallback to cache even if online but API failed
      try {
        const cached = await offlineStore.getItems(projectId)
        return cached.map(dbItem => ({
          id: dbItem.id,
          project_id: dbItem.project_id,
          name: dbItem.name,
          description: dbItem.description,
          quantity: dbItem.quantity,
          unit_cost: dbItem.unit_cost,
          created_at: dbItem.created_at,
          updated_at: dbItem.updated_at
        }))
      } catch (cacheError) {
        throw error // Throw original error if cache also fails
      }
    }
  }
}

export const offlineItemService = new OfflineItemService()
```

## Step 2: Network State Detection

### Create `/src/hooks/useNetworkState.ts`

```typescript
import { useState, useEffect } from 'react'

interface NetworkState {
  isOnline: boolean
  isSlowConnection: boolean
  lastOnline: Date | null
  connectionType: string
}

export function useNetworkState(): NetworkState {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isOnline: navigator.onLine,
    isSlowConnection: false,
    lastOnline: navigator.onLine ? new Date() : null,
    connectionType: 'unknown'
  })

  useEffect(() => {
    const updateNetworkState = async () => {
      const isOnline = navigator.onLine

      let isSlowConnection = false
      let connectionType = 'unknown'

      // Check connection quality if Network Information API is available
      if ('connection' in navigator) {
        const conn = (navigator as any).connection
        connectionType = conn.effectiveType || 'unknown'
        isSlowConnection = conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g'
      }

      // Test actual connectivity with a ping
      let actualOnline = isOnline
      if (isOnline) {
        try {
          const response = await fetch('/ping', {
            method: 'HEAD',
            cache: 'no-cache',
            signal: AbortSignal.timeout(5000)
          })
          actualOnline = response.ok
        } catch {
          actualOnline = false
        }
      }

      setNetworkState({
        isOnline: actualOnline,
        isSlowConnection,
        lastOnline: actualOnline ? new Date() : networkState.lastOnline,
        connectionType
      })
    }

    // Initial check
    updateNetworkState()

    // Listen for network changes
    window.addEventListener('online', updateNetworkState)
    window.addEventListener('offline', updateNetworkState)

    // Periodic connectivity checks (every 30 seconds)
    const interval = setInterval(updateNetworkState, 30000)

    return () => {
      window.removeEventListener('online', updateNetworkState)
      window.removeEventListener('offline', updateNetworkState)
      clearInterval(interval)
    }
  }, [])

  return networkState
}
```

### Create `/src/components/NetworkStatus.tsx`

```typescript
import React from 'react'
import { useNetworkState } from '../hooks/useNetworkState'
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react'

export function NetworkStatus() {
  const { isOnline, isSlowConnection, connectionType } = useNetworkState()

  if (isOnline && !isSlowConnection) {
    return null // Don't show anything when everything is fine
  }

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium ${
      isOnline
        ? 'bg-yellow-50 text-yellow-800 border-b border-yellow-200'
        : 'bg-red-50 text-red-800 border-b border-red-200'
    }`}>
      <div className="flex items-center gap-2">
        {isOnline ? (
          <>
            <Wifi className="w-4 h-4" />
            {isSlowConnection ? 'Slow connection' : 'Online'}
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            Offline - Changes will sync when reconnected
          </>
        )}
        {isSlowConnection && (
          <AlertTriangle className="w-4 h-4 ml-2" />
        )}
      </div>
    </div>
  )
}
```

## Step 3: App Initialization

### Update `/src/App.tsx`

```typescript
import { useEffect } from 'react'
import { offlineStore } from './services/offlineStore'
import { NetworkStatus } from './components/NetworkStatus'

function App() {
  useEffect(() => {
    // Initialize offline store on app startup
    const initOfflineStore = async () => {
      try {
        await offlineStore.init()
        console.log('Offline store initialized')
      } catch (error) {
        console.error('Failed to initialize offline store:', error)
      }
    }

    initOfflineStore()
  }, [])

  return (
    <>
      <NetworkStatus />
      {/* Rest of your app */}
    </>
  )
}

export default App
```

## Step 4: Update React Query Configuration

### Update `/src/lib/react-query.ts` (or wherever you configure React Query)

```typescript
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes
      retry: (failureCount, error) => {
        // Don't retry on network errors when offline
        if (!navigator.onLine && failureCount >= 1) return false
        return failureCount < 3
      },
    },
  },
})
```

## Testing Criteria

### Unit Tests
- [ ] `offlineStore.init()` creates IndexedDB with correct schema
- [ ] `offlineStore.getItems()` returns cached items for a project
- [ ] `offlineStore.saveItems()` persists items to IndexedDB
- [ ] `useNetworkState()` returns correct online/offline state
- [ ] Network status updates when connection changes

### Integration Tests
- [ ] App initializes offline store on startup
- [ ] NetworkStatus component shows correct status
- [ ] Items are cached after successful API calls
- [ ] Cached items are served when offline
- [ ] API calls still work when online

### Manual Testing
- [ ] Open app online, navigate to items page
- [ ] Go offline, refresh page - should show cached items
- [ ] Make network unavailable, verify offline indicator appears
- [ ] Reconnect network, verify online indicator

## Success Metrics
- App loads cached data in <2 seconds
- Offline store initializes without errors
- Network state detection works reliably
- No data loss when switching between online/offline

## Next Steps
After this phase is complete and tested, proceed to Phase 2: Operation Queuing.