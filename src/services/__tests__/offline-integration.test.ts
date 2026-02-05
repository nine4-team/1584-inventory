import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { offlineStore } from '../offlineStore'
import { operationQueue } from '../operationQueue'
import { offlineItemService } from '../offlineItemService'
import { offlineMediaService } from '../offlineMediaService'
import * as supabaseModule from '../supabase'
import { conflictDetector } from '../conflictDetector'
import { conflictResolver } from '../conflictResolver'
import { unifiedItemsService } from '../inventoryService'
import * as networkStatusModule from '../networkStatusService'
import { updateOfflineContext } from '../offlineContext'

let userSpy: ReturnType<typeof vi.spyOn> | null = null
let getSessionSpy: ReturnType<typeof vi.spyOn> | null = null
let refreshSessionSpy: ReturnType<typeof vi.spyOn> | null = null
let conflictSpy: ReturnType<typeof vi.spyOn> | null = null

vi.mock('../networkStatusService', () => ({
  isNetworkOnline: vi.fn(() => true),
  withNetworkTimeout: vi.fn((fn: any) => fn(new AbortController().signal)),
  NetworkTimeoutError: class extends Error {}
}))

const TEST_ACCOUNT_ID = 'acc-123'

describe('Offline Integration Tests', () => {
  beforeEach(async () => {
    vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)
    userSpy = vi.spyOn(supabaseModule, 'getCurrentUser').mockResolvedValue({
      id: 'test-user',
      email: 'offline@test.local'
    } as any)
    getSessionSpy = vi.spyOn(supabaseModule.supabase.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
          expires_at: Math.floor(Date.now() / 1000) + 600
        }
      },
      error: null
    } as any)
    refreshSessionSpy = vi.spyOn(supabaseModule.supabase.auth, 'refreshSession').mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
          expires_at: Math.floor(Date.now() / 1000) + 600
        }
      },
      error: null
    } as any)
    conflictSpy = vi.spyOn(conflictDetector, 'detectConflicts').mockResolvedValue([])
    await offlineStore.init()
    await offlineStore.clearAll()
    await operationQueue.clearQueue()
    await updateOfflineContext({ userId: 'test-user', accountId: TEST_ACCOUNT_ID })
  })

  afterEach(async () => {
    userSpy?.mockRestore()
    userSpy = null
    getSessionSpy?.mockRestore()
    getSessionSpy = null
    refreshSessionSpy?.mockRestore()
    refreshSessionSpy = null
    conflictSpy?.mockRestore()
    conflictSpy = null
    await offlineStore.clearAll()
    await operationQueue.clearQueue()
    await updateOfflineContext({ userId: null, accountId: null })
    vi.clearAllMocks()
  })

  describe('Offline to Online Transition', () => {
    it('should sync queued operations when coming online', async () => {
      // Start offline
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      // Create item offline
      await offlineItemService.createItem(TEST_ACCOUNT_ID, {
        projectId: 'proj-123',
        name: 'Offline Item',
        description: 'Created while offline'
      })

      // Verify operation is queued
      expect(operationQueue.getQueueLength()).toBe(1)

      // Come online
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)

      // Mock successful server sync
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from').mockImplementation(() => ({
        upsert: (payload: any) => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                ...payload,
                id: payload.item_id,
                item_id: payload.item_id,
                account_id: payload.account_id,
                project_id: payload.project_id,
                version: payload.version ?? 1
              },
              error: null
            })
          })
        })
      } as any))

      // Process queue
      await operationQueue.processQueue()
      fromSpy.mockRestore()

      // Verify operation was processed
      expect(operationQueue.getQueueLength()).toBe(0)

      // Verify item was cached locally
      const cachedItems = await offlineStore.getItems('proj-123')
      expect(cachedItems).toHaveLength(1)
      expect(cachedItems[0].name).toBe('Offline Item')
    })

    it('should handle sync failures gracefully', async () => {
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      // Create item
      await offlineItemService.createItem(TEST_ACCOUNT_ID, {
        projectId: 'proj-123',
        name: 'Failing Item'
      })

      // Mock server failure
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from').mockImplementation(() => ({
        upsert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: null,
              error: { message: 'Network error' }
            })
          })
        })
      } as any))

      // Process queue
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)
      await operationQueue.processQueue()

      // Verify operation is still queued for retry
      expect(operationQueue.getQueueLength()).toBe(1)

      const pending = operationQueue.getPendingOperations()
      expect(pending[0].retryCount).toBe(1)
      expect(pending[0].lastError).toBe('Sync failed')

      fromSpy.mockRestore()
    })
  })

  describe('Data Consistency', () => {
    it('should maintain data consistency during offline operations', async () => {
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      const createResult = await offlineItemService.createItem(TEST_ACCOUNT_ID, {
        projectId: 'proj-123',
        name: 'Original Item',
        description: 'Original Item',
        source: 'Test Source',
        sku: 'TEST-ITEM',
        paymentMethod: 'cash',
        qrKey: 'QR-ITEM',
        bookmark: false,
        disposition: 'purchased' as const
      })
      const createdItemId = createResult.itemId ?? 'item-integration-test'

      // Mock server response for initial create
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from')
      fromSpy.mockImplementationOnce(() => ({
        upsert: (payload: any) => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                ...payload,
                id: payload.item_id,
                item_id: payload.item_id,
                account_id: payload.account_id,
                project_id: payload.project_id,
                name: 'Original Item',
                version: payload.version ?? 1
              },
              error: null
            })
          })
        })
      } as any))

      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)
      await operationQueue.processQueue()

      // Update the item
      const updateOp = {
        type: 'UPDATE_ITEM' as const,
        data: {
          id: createdItemId,
          accountId: TEST_ACCOUNT_ID,
          updates: { name: 'Updated Item' }
        }
      }

      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)
      await operationQueue.add(updateOp, {
        accountId: TEST_ACCOUNT_ID,
        version: 2,
        timestamp: new Date().toISOString()
      })

      // Mock update response
      const updateChain = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: createdItemId,
            item_id: createdItemId,
            account_id: TEST_ACCOUNT_ID,
            project_id: 'proj-123',
            name: 'Updated Item',
            version: 2,
            last_updated: new Date().toISOString()
          },
          error: null
        })
      }
      fromSpy.mockImplementationOnce(() => ({
        update: () => updateChain
      } as any))

      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)
      await operationQueue.processQueue()

      // Verify local store reflects the update
      const items = await offlineStore.getAllItems()
      expect(items).toHaveLength(1)
      expect(items[0].name).toBe('Updated Item')
      expect(items[0].version).toBe(2)

      fromSpy.mockRestore()
    })
  })

  describe('Storage Management', () => {
    it('should handle storage quota limits', async () => {
      // Mock storage quota check to return high usage
      const quotaSpy = vi.spyOn(offlineStore, 'checkStorageQuota').mockResolvedValue({
        usageBytes: 135 * 1024 * 1024, // 135MB
        quotaBytes: 150 * 1024 * 1024,  // 150MB
        usageRatio: 0.9
      })

      const largeBlob = new Blob(['x'.repeat(1024 * 1024)], { type: 'application/octet-stream' }) // 1MB
      const file = new File([largeBlob], 'large-file.dat')

      // Try to save media that would exceed quota
      const { offlineMediaService } = await import('../offlineMediaService')

      await expect(
        offlineMediaService.saveMediaFile('acc-123', 'item-123', file)
      ).rejects.toThrow('Storage quota nearly full')

      quotaSpy.mockRestore()
    })

    it('should cleanup expired media', async () => {
      // Save media with expiration
      const blob = new Blob(['test'], { type: 'text/plain' })
      const file = new File([blob], 'test.txt')
      const expiredDate = new Date(Date.now() - 1000) // Already expired

      await offlineMediaService.saveMediaFile('acc-123', 'item-123', file, expiredDate)

      // Cleanup expired media
      const deletedCount = await offlineMediaService.cleanupExpiredMedia()
      expect(deletedCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Media Upload Queue', () => {
    it('should queue media uploads when offline', async () => {
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      const blob = new Blob(['test image'], { type: 'image/jpeg' })
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' })

      const result = await offlineMediaService.queueMediaUpload('acc-123', 'item-123', file)

      expect(result.queued).toBe(true)
      expect(result.mediaId).toBeDefined()

      // Check upload queue
      const queue = await offlineStore.getMediaUploadQueue('acc-123')
      expect(queue).toHaveLength(1)
      expect(queue[0].mediaId).toBe(result.mediaId)
      expect(queue[0].itemId).toBe('item-123')
    })

    it('should process queued uploads when coming online', async () => {
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      // Queue a media upload
      const blob = new Blob(['test image'], { type: 'image/jpeg' })
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' })
      const result = await offlineMediaService.queueMediaUpload('acc-123', 'item-123', file)

      // Come online
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)

      // Process queue (would normally upload to Supabase Storage)
      const processResult = await offlineMediaService.processQueuedUploads('acc-123')

      // Queue entry should be removed after processing
      const queue = await offlineStore.getMediaUploadQueue('acc-123')
      expect(queue.length).toBeLessThanOrEqual(0) // May be removed or still there if upload fails
    })
  })

  describe('Conflict Resolution Flow', () => {
    it('should detect and resolve conflicts during sync', async () => {
      // Create local item
      await offlineStore.saveItems([{
        itemId: 'item-123',
        accountId: TEST_ACCOUNT_ID,
        projectId: 'proj-123',
        name: 'Local Name',
        version: 1,
        lastUpdated: '2024-01-01T00:00:00Z',
        last_synced_at: '2024-01-01T00:00:00Z'
      }])

      // Mock server item with different name
      const serverItem = {
        id: 'uuid-123',
        item_id: 'item-123',
        account_id: TEST_ACCOUNT_ID,
        project_id: 'proj-123',
        name: 'Server Name',
        version: 2,
        last_updated: '2024-01-01T00:10:00Z'
      }

      // Mock conflict detection
      conflictSpy.mockResolvedValueOnce([{
        id: 'item-123',
        type: 'content',
        field: 'name',
        local: {
          data: { name: 'Local Name' },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: { name: 'Server Name' },
          timestamp: '2024-01-01T00:10:00Z',
          version: 2
        }
      }])

      // Detect conflicts
      const conflicts = await conflictDetector.detectConflicts('proj-123')
      expect(conflicts).toHaveLength(1)

      // Resolve conflicts (auto-resolve: server wins for version conflicts)
      const resolutions = await conflictResolver.resolveConflicts(conflicts)
      expect(resolutions).toHaveLength(1)
      expect(resolutions[0].resolution.strategy).toBe('manual')
    })
  })

  describe('Long-lived Offline Session', () => {
    it('should handle multiple operations during extended offline period', async () => {
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      // Create multiple items offline
      for (let i = 0; i < 5; i++) {
        await offlineItemService.createItem(TEST_ACCOUNT_ID, {
          projectId: 'proj-123',
          name: `Offline Item ${i}`,
          description: `Created offline at ${i}`
        })
      }

      // Verify all operations are queued
      expect(operationQueue.getQueueLength()).toBe(5)

      // Come online and process
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)

      // Mock successful server responses
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from').mockImplementation(() => ({
        upsert: (payload: any) => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                ...payload,
                id: payload.item_id,
                item_id: payload.item_id,
                account_id: payload.account_id,
                project_id: payload.project_id,
                name: payload.name ?? 'Offline Item',
                version: payload.version ?? 1
              },
              error: null
            })
          })
        })
      } as any))

      await operationQueue.processQueue()
      await new Promise(resolve => setTimeout(resolve, 600))

      // All operations should be processed
      expect(operationQueue.getQueueLength()).toBe(0)

      fromSpy.mockRestore()
    })
  })

  describe('Cold Start Offline', () => {
    it('should load cached data when starting app offline', async () => {
      // Pre-populate cache with items
      await offlineStore.saveItems([
        {
          itemId: 'item-1',
          accountId: TEST_ACCOUNT_ID,
          projectId: 'proj-123',
          name: 'Cached Item 1',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z',
          last_synced_at: '2024-01-01T00:00:00Z'
        },
        {
          itemId: 'item-2',
          accountId: TEST_ACCOUNT_ID,
          projectId: 'proj-123',
          name: 'Cached Item 2',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z',
          last_synced_at: '2024-01-01T00:00:00Z'
        }
      ])

      // Start offline
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      // Load items from cache
      const cachedItems = await offlineStore.getItems('proj-123')
      expect(cachedItems).toHaveLength(2)
      expect(cachedItems[0].name).toBe('Cached Item 1')
      expect(cachedItems[1].name).toBe('Cached Item 2')
    })
  })

  describe('Offline Item Creation via unifiedItemsService', () => {
    it('should queue item creation when offline and persist to IndexedDB', async () => {
      // Start offline
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      const itemData = {
        projectId: 'proj-123',
        description: 'Test item',
        source: 'Test Source',
        sku: 'TEST-001',
        purchasePrice: '100.00',
        projectPrice: '150.00',
        paymentMethod: 'cash',
        qrKey: 'QR-TEST-001',
        bookmark: false,
        disposition: 'purchased' as const
      }

      // Create item via unifiedItemsService (should delegate to offlineItemService)
      const result = await unifiedItemsService.createItem(TEST_ACCOUNT_ID, itemData)

      // Verify operation is queued
      expect(operationQueue.getQueueLength()).toBe(1)
      const pendingOps = operationQueue.getPendingOperations()
      expect(pendingOps[0].type).toBe('CREATE_ITEM')
      expect(pendingOps[0].accountId).toBe(TEST_ACCOUNT_ID)

      // Verify optimistic item is stored in offlineStore
      const cachedItems = await offlineStore.getAllItems()
      const cachedItem = cachedItems.find(item => item.description === 'Test item')
      expect(cachedItem).toBeDefined()
      expect(cachedItem?.accountId).toBe(TEST_ACCOUNT_ID)
      expect(cachedItem?.projectId).toBe('proj-123')

      // Verify offline branch returned metadata
      expect(result.mode).toBe('offline')
      expect(result.itemId).toMatch(/^I-/)
      expect(result.operationId).toBeDefined()
    })

    it('should persist queue across app reloads', async () => {
      // Start offline
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      const itemData = {
        projectId: 'proj-123',
        description: 'Persistent item',
        source: 'Test Source',
        sku: 'TEST-002',
        purchasePrice: '200.00',
        projectPrice: '250.00',
        paymentMethod: 'cash',
        qrKey: 'QR-TEST-002',
        bookmark: false,
        disposition: 'purchased' as const
      }

      // Create item offline
      await unifiedItemsService.createItem(TEST_ACCOUNT_ID, itemData)
      expect(operationQueue.getQueueLength()).toBe(1)

      // Simulate app reload by re-initializing operationQueue
      await operationQueue.init()

      // Verify queue persisted
      expect(operationQueue.getQueueLength()).toBe(1)
      const pendingOps = operationQueue.getPendingOperations()
      expect(pendingOps[0].type).toBe('CREATE_ITEM')
      expect(pendingOps[0].data).toMatchObject({
        accountId: TEST_ACCOUNT_ID,
        projectId: 'proj-123'
      })
    })

    it('should handle conflict detection during sync', async () => {
      // Start offline
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(false)

      const itemData = {
        projectId: 'proj-123',
        description: 'Conflict item',
        source: 'Test Source',
        sku: 'TEST-003',
        purchasePrice: '300.00',
        projectPrice: '350.00',
        paymentMethod: 'cash',
        qrKey: 'QR-TEST-003',
        bookmark: false,
        disposition: 'purchased' as const
      }

      // Create item offline
      await unifiedItemsService.createItem(TEST_ACCOUNT_ID, itemData)
      expect(operationQueue.getQueueLength()).toBe(1)

      // Mock conflict detection
      conflictSpy?.mockResolvedValueOnce([
        {
          itemId: 'temp-item-id',
          localVersion: 1,
          serverVersion: 2,
          localData: { description: 'Conflict item' },
          serverData: { description: 'Updated on server' },
          conflicts: ['description']
        }
      ])

      // Come online and attempt sync
      vi.mocked(networkStatusModule.isNetworkOnline).mockReturnValue(true)

      // Mock server to return conflict
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from').mockImplementation(() => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.reject(new Error('Conflict detected'))
          })
        })
      } as any))

      // Process queue (should detect conflict and block)
      await operationQueue.processQueue()

      // Verify conflict was detected
      expect(conflictSpy).toHaveBeenCalled()

      fromSpy.mockRestore()
    })
  })
})