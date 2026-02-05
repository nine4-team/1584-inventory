import { describe, it, expect, beforeEach, vi } from 'vitest'
import { conflictDetector } from '../conflictDetector'
import { offlineStore } from '../offlineStore'
import { supabase } from '../supabase'

// Mock dependencies
vi.mock('../offlineStore')
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn()
  }
}))

describe('ConflictDetector', () => {
  const mockedOfflineStore = vi.mocked(offlineStore)
  const mockedSupabase = vi.mocked(supabase)

  beforeEach(() => {
    vi.clearAllMocks()
    mockedOfflineStore.deleteAllConflictsForProject.mockResolvedValue(undefined as any)
    mockedOfflineStore.deleteConflictsForProject.mockResolvedValue(undefined as any)
    mockedOfflineStore.saveConflict.mockResolvedValue(undefined as any)
  })

  describe('detectConflicts', () => {
    it('should detect version conflicts', async () => {
      const localItems = [
        {
          itemId: 'item-1',
          accountId: 'acc-123',
          name: 'Local Item',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      ]

      const serverItems = [
        {
          id: 'uuid-1',
          item_id: 'item-1',
          account_id: 'acc-123',
          name: 'Server Item',
          version: 2,
          last_updated: '2024-01-01T00:01:00Z'
        }
      ]

      mockedOfflineStore.getItems.mockResolvedValue(localItems as any)
      mockedSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: serverItems,
            error: null
          })
        })
      } as any)

      const conflicts = await conflictDetector.detectConflicts('project-123')

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].type).toBe('version')
      expect(conflicts[0].id).toBe('item-1')
      expect(conflicts[0].local.version).toBe(1)
      expect(conflicts[0].server.version).toBe(2)
    })

    it('should detect timestamp conflicts', async () => {
      const localItems = [
        {
          itemId: 'item-1',
          accountId: 'acc-123',
          name: 'Local Item',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      ]

      const serverItems = [
        {
          id: 'uuid-1',
          item_id: 'item-1',
          account_id: 'acc-123',
          name: 'Server Item',
          version: 1,
          last_updated: '2024-01-01T00:10:00Z' // 10 minutes later
        }
      ]

      mockedOfflineStore.getItems.mockResolvedValue(localItems as any)
      mockedSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: serverItems,
            error: null
          })
        })
      } as any)

      const conflicts = await conflictDetector.detectConflicts('project-123')

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].type).toBe('timestamp')
    })

    it('should detect content conflicts', async () => {
      const localItems = [
        {
          itemId: 'item-1',
          accountId: 'acc-123',
          name: 'Local Name',
          description: 'Local Description',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      ]

      const serverItems = [
        {
          id: 'uuid-1',
          item_id: 'item-1',
          account_id: 'acc-123',
          name: 'Server Name', // Different name
          description: 'Local Description',
          version: 1,
          last_updated: '2024-01-01T00:00:00Z'
        }
      ]

      mockedOfflineStore.getItems.mockResolvedValue(localItems as any)
      mockedSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: serverItems,
            error: null
          })
        })
      } as any)

      const conflicts = await conflictDetector.detectConflicts('project-123')

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].type).toBe('content')
      expect(conflicts[0].field).toBe('name')
    })

    it('should not detect conflicts for identical items', async () => {
      const localItems = [
        {
          itemId: 'item-1',
          accountId: 'acc-123',
          name: 'Test Item',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      ]

      const serverItems = [
        {
          id: 'uuid-1',
          item_id: 'item-1',
          account_id: 'acc-123',
          name: 'Test Item',
          version: 1,
          last_updated: '2024-01-01T00:00:00Z'
        }
      ]

      mockedOfflineStore.getItems.mockResolvedValue(localItems as any)
      mockedSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: serverItems,
            error: null
          })
        })
      } as any)

      const conflicts = await conflictDetector.detectConflicts('project-123')

      expect(conflicts).toHaveLength(0)
    })

    it('should skip items that exist locally but not on server', async () => {
      const localItems = [
        {
          itemId: 'item-1',
          accountId: 'acc-123',
          name: 'New Item',
          version: 1,
          lastUpdated: '2024-01-01T00:00:00Z'
        }
      ]

      const serverItems: any[] = [] // Item doesn't exist on server

      mockedOfflineStore.getItems.mockResolvedValue(localItems as any)
      mockedSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: serverItems,
            error: null
          })
        })
      } as any)

      const conflicts = await conflictDetector.detectConflicts('project-123')

      // Should not detect conflicts for new items (create operations)
      expect(conflicts).toHaveLength(0)
    })

    it('should handle errors gracefully', async () => {
      mockedOfflineStore.getItems.mockRejectedValue(new Error('Database error'))

      const conflicts = await conflictDetector.detectConflicts('project-123')

      // Should return empty array on error
      expect(conflicts).toHaveLength(0)
    })
  })
})
