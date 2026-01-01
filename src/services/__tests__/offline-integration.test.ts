import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { offlineStore } from '../offlineStore'
import { operationQueue } from '../operationQueue'
import { offlineItemService } from '../offlineItemService'
import * as supabaseModule from '../supabase'

let userSpy: ReturnType<typeof vi.spyOn> | null = null

// Mock network state
const mockNavigator = {
  onLine: true
}
Object.defineProperty(navigator, 'onLine', {
  get: () => mockNavigator.onLine,
  set: (value) => { mockNavigator.onLine = value }
})

describe('Offline Integration Tests', () => {
  beforeEach(async () => {
    userSpy = vi.spyOn(supabaseModule, 'getCurrentUser').mockResolvedValue({
      id: 'test-user',
      email: 'offline@test.local'
    } as any)
    await offlineStore.init()
    await offlineStore.clearAll()
    await operationQueue.clearQueue()
  })

  afterEach(async () => {
    userSpy?.mockRestore()
    userSpy = null
    await offlineStore.clearAll()
    await operationQueue.clearQueue()
    vi.clearAllMocks()
  })

  describe('Offline to Online Transition', () => {
    it('should sync queued operations when coming online', async () => {
      // Start offline
      mockNavigator.onLine = false

      // Create item offline
      await offlineItemService.createItem({
        projectId: 'proj-123',
        name: 'Offline Item',
        description: 'Created while offline'
      })

      // Verify operation is queued
      expect(operationQueue.getQueueLength()).toBe(1)

      // Come online
      mockNavigator.onLine = true

      // Mock successful server sync
      vi.spyOn(await import('../supabase'), 'supabase').mockImplementation(() => ({
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: 'server-item-123',
                  account_id: 'acc-123',
                  project_id: 'proj-123',
                  name: 'Offline Item',
                  description: 'Created while offline',
                  version: 1
                },
                error: null
              })
            })
          })
        })
      } as any))

      // Process queue
      await operationQueue.processQueue()

      // Verify operation was processed
      expect(operationQueue.getQueueLength()).toBe(0)

      // Verify item was cached locally
      const cachedItems = await offlineStore.getItems('proj-123')
      expect(cachedItems).toHaveLength(1)
      expect(cachedItems[0].name).toBe('Offline Item')
    })

    it('should handle sync failures gracefully', async () => {
      mockNavigator.onLine = true

      // Create item
      await offlineItemService.createItem({
        projectId: 'proj-123',
        name: 'Failing Item'
      })

      // Mock server failure
      vi.spyOn(await import('../supabase'), 'supabase').mockImplementation(() => ({
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: null,
                error: { message: 'Network error' }
              })
            })
          })
        })
      } as any))

      // Process queue
      await operationQueue.processQueue()

      // Verify operation is still queued for retry
      expect(operationQueue.getQueueLength()).toBe(1)

      const pending = operationQueue.getPendingOperations()
      expect(pending[0].retryCount).toBe(1)
      expect(pending[0].lastError).toBe('Sync failed')
    })
  })

  describe('Data Consistency', () => {
    it('should maintain data consistency during offline operations', async () => {
      mockNavigator.onLine = true

      // Create initial item
      const createOp = {
        type: 'CREATE_ITEM' as const,
        data: {
          projectId: 'proj-123',
          name: 'Original Item'
        }
      }

      await operationQueue.add(createOp)

      // Mock server response
      vi.spyOn(await import('../supabase'), 'supabase').mockImplementation(() => ({
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: 'item-123',
                  account_id: 'acc-123',
                  project_id: 'proj-123',
                  name: 'Original Item',
                  version: 1
                },
                error: null
              })
            })
          })
        })
      } as any))

      await operationQueue.processQueue()

      // Update the item
      const updateOp = {
        type: 'UPDATE_ITEM' as const,
        data: {
          id: 'item-123',
          updates: { name: 'Updated Item' }
        }
      }

      await operationQueue.add(updateOp)

      // Mock update response
      const mockSupabase = vi.spyOn(await import('../supabase'), 'supabase')
      mockSupabase.mockImplementation(() => ({
        from: () => ({
          update: () => ({
            eq: () => Promise.resolve({
              data: null,
              error: null
            })
          })
        })
      } as any))

      await operationQueue.processQueue()

      // Verify local store reflects the update
      const items = await offlineStore.getItems('proj-123')
      expect(items).toHaveLength(1)
      expect(items[0].name).toBe('Updated Item')
      expect(items[0].version).toBe(2)
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