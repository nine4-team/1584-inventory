import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { offlineStore } from '../offlineStore'

describe('OfflineStore', () => {
  beforeEach(async () => {
    // Clear all data before each test
    await offlineStore.init()
    await offlineStore.clearAll()
  })

  afterEach(async () => {
    // Clean up after each test
    await offlineStore.clearAll()
  })

  describe('Items CRUD', () => {
    it('should save and retrieve items', async () => {
      const testItem = {
        itemId: 'test-123',
        accountId: 'acc-123',
        projectId: 'project-123',
        name: 'Test Item',
        description: 'Test description',
        version: 1,
        last_synced_at: new Date().toISOString()
      }

      await offlineStore.saveItems([testItem])
      const items = await offlineStore.getItems('project-123')

      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        itemId: 'test-123',
        name: 'Test Item'
      })
    })

    it('should update existing items without resetting version', async () => {
      const originalItem = {
        itemId: 'test-123',
        accountId: 'acc-123',
        projectId: 'project-123',
        name: 'Original Name',
        version: 5,
        last_synced_at: '2024-01-01T00:00:00Z'
      }

      await offlineStore.saveItems([originalItem])

      // Update without version
      const updatedItem = {
        ...originalItem,
        name: 'Updated Name'
        // Note: no version specified
      }

      await offlineStore.upsertItem(updatedItem)

      const items = await offlineStore.getItems('project-123')
      expect(items[0].name).toBe('Updated Name')
      expect(items[0].version).toBe(5) // Should preserve original version
    })

    it('should get all items', async () => {
      const items = [
        { itemId: '1', accountId: 'acc-123', name: 'Item 1', version: 1 },
        { itemId: '2', accountId: 'acc-123', name: 'Item 2', version: 1 }
      ]

      await offlineStore.saveItems(items)
      const allItems = await offlineStore.getAllItems()

      expect(allItems).toHaveLength(2)
    })
  })

  describe('Cache functionality', () => {
    it('should cache and retrieve data', async () => {
      const testData = { items: ['item1', 'item2'], total: 2 }
      const cacheKey = 'test-items'

      await offlineStore.setCachedData(cacheKey, testData)
      const cached = await offlineStore.getCachedData(cacheKey)

      expect(cached).toEqual(testData)
    })

    it('should return null for expired cache', async () => {
      const testData = { expired: true }
      const cacheKey = 'expired-data'

      // Set with expiration in the past
      await offlineStore.setCachedData(cacheKey, testData, -1000) // Expired 1 second ago

      const cached = await offlineStore.getCachedData(cacheKey)
      expect(cached).toBeNull()
    })
  })

  describe('Storage quota', () => {
    it('should check storage quota', async () => {
      const status = await offlineStore.checkStorageQuota()

      expect(status).toHaveProperty('usageBytes')
      expect(status).toHaveProperty('quotaBytes')
      expect(status).toHaveProperty('usageRatio')
      expect(status.usageRatio).toBeGreaterThanOrEqual(0)
      expect(status.usageRatio).toBeLessThanOrEqual(1)
    })
  })

  describe('Conflicts', () => {
    it('should save and retrieve conflicts', async () => {
      const conflict = {
        itemId: 'item-123',
        accountId: 'acc-123',
        type: 'content' as const,
        field: 'name',
        local: {
          data: { name: 'Local Name' },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: { name: 'Server Name' },
          timestamp: '2024-01-01T00:01:00Z',
          version: 2
        }
      }

      await offlineStore.saveConflict(conflict)
      const conflicts = await offlineStore.getConflicts('acc-123', false)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].itemId).toBe('item-123')
      expect(conflicts[0].type).toBe('content')
    })

    it('should resolve conflicts', async () => {
      const conflict = {
        itemId: 'item-123',
        accountId: 'acc-123',
        type: 'content' as const,
        local: { data: {}, timestamp: '', version: 1 },
        server: { data: {}, timestamp: '', version: 1 }
      }

      await offlineStore.saveConflict(conflict)
      const conflicts = await offlineStore.getConflicts('acc-123', false)
      const conflictId = conflicts[0].id

      await offlineStore.resolveConflict(conflictId, 'local')

      const resolvedConflicts = await offlineStore.getConflicts('acc-123', true)
      expect(resolvedConflicts).toHaveLength(1)
      expect(resolvedConflicts[0].resolution).toBe('local')
    })
  })
})