import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { offlineStore } from '../offlineStore'
import { operationQueue } from '../operationQueue'
import { offlineItemService } from '../offlineItemService'
import * as supabaseModule from '../supabase'
import { conflictDetector } from '../conflictDetector'

let userSpy: ReturnType<typeof vi.spyOn> | null = null
let getSessionSpy: ReturnType<typeof vi.spyOn> | null = null
let refreshSessionSpy: ReturnType<typeof vi.spyOn> | null = null
let conflictSpy: ReturnType<typeof vi.spyOn> | null = null

// Mock network state
const mockNavigator = {
  onLine: true
}
Object.defineProperty(navigator, 'onLine', {
  get: () => mockNavigator.onLine,
  set: (value) => { mockNavigator.onLine = value },
  configurable: true
})

const TEST_ACCOUNT_ID = 'acc-123'

describe('Offline Integration Tests', () => {
  beforeEach(async () => {
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
    vi.clearAllMocks()
  })

  describe('Offline to Online Transition', () => {
    it('should sync queued operations when coming online', async () => {
      // Start offline
      mockNavigator.onLine = false

      // Create item offline
      await offlineItemService.createItem(TEST_ACCOUNT_ID, {
        projectId: 'proj-123',
        name: 'Offline Item',
        description: 'Created while offline'
      })

      // Verify operation is queued
      expect(operationQueue.getQueueLength()).toBe(1)

      // Come online
      mockNavigator.onLine = true

      // Mock successful server sync
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from').mockImplementation(() => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                id: 'server-item-123',
                account_id: TEST_ACCOUNT_ID,
                project_id: 'proj-123',
                name: 'Offline Item',
                description: 'Created while offline',
                version: 1
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
      mockNavigator.onLine = false

      // Create item
      await offlineItemService.createItem(TEST_ACCOUNT_ID, {
        projectId: 'proj-123',
        name: 'Failing Item'
      })

      // Mock server failure
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from').mockImplementation(() => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: null,
              error: { message: 'Network error' }
            })
          })
        })
      } as any))

      // Process queue
      mockNavigator.onLine = true
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
      mockNavigator.onLine = false

      // Create initial item
      const createOp = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: TEST_ACCOUNT_ID,
          projectId: 'proj-123',
          name: 'Original Item'
        }
      }

      await operationQueue.add(createOp)

      // Mock server response for initial create
      const fromSpy = vi.spyOn(supabaseModule.supabase, 'from')
      fromSpy.mockImplementationOnce(() => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                id: 'item-123',
                account_id: TEST_ACCOUNT_ID,
                project_id: 'proj-123',
                name: 'Original Item',
                version: 1
              },
              error: null
            })
          })
        })
      } as any))

      mockNavigator.onLine = true
      await operationQueue.processQueue()

      // Update the item
      const updateOp = {
        type: 'UPDATE_ITEM' as const,
        data: {
          id: 'item-123',
          accountId: TEST_ACCOUNT_ID,
          updates: { name: 'Updated Item' }
        }
      }

      mockNavigator.onLine = false
      await operationQueue.add(updateOp, {
        accountId: TEST_ACCOUNT_ID,
        version: 2,
        timestamp: new Date().toISOString()
      })

      // Mock update response
      fromSpy.mockImplementationOnce(() => ({
        update: () => ({
          eq: () => Promise.resolve({
            data: null,
            error: null
          })
        })
      } as any))

      mockNavigator.onLine = true
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
        usageBytes: 45 * 1024 * 1024, // 45MB
        quotaBytes: 50 * 1024 * 1024,  // 50MB
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
      const { offlineMediaService } = await import('../offlineMediaService')

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
})