import { describe, it, expect, beforeEach, vi } from 'vitest'
import { conflictResolver } from '../conflictResolver'
import { offlineStore } from '../offlineStore'
import { supabase } from '../supabase'
import type { ConflictItem, Resolution } from '../../types/conflicts'

// Mock dependencies
vi.mock('../offlineStore')
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn()
    }
  }
}))

describe('ConflictResolver', () => {
  const mockedOfflineStore = vi.mocked(offlineStore)
  const mockedSupabase = vi.mocked(supabase)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolveConflicts', () => {
    it('should auto-resolve version conflicts (server wins)', async () => {
      const conflicts: ConflictItem[] = [
        {
          id: 'item-1',
          type: 'version',
          field: 'version',
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
      ]

      const resolutions = await conflictResolver.resolveConflicts(conflicts)

      expect(resolutions).toHaveLength(1)
      expect(resolutions[0].resolution.strategy).toBe('keep_server')
      expect(resolutions[0].resolution.resolvedData).toEqual(conflicts[0].server.data)
    })

    it('should auto-resolve timestamp conflicts when server is significantly newer', async () => {
      const conflicts: ConflictItem[] = [
        {
          id: 'item-1',
          type: 'timestamp',
          field: 'timestamp',
          local: {
            data: { name: 'Local Name' },
            timestamp: '2024-01-01T00:00:00Z',
            version: 1
          },
          server: {
            data: { name: 'Server Name' },
            timestamp: '2024-01-01T00:10:00Z', // 10 minutes later
            version: 1
          }
        }
      ]

      const resolutions = await conflictResolver.resolveConflicts(conflicts)

      expect(resolutions).toHaveLength(1)
      expect(resolutions[0].resolution.strategy).toBe('keep_server')
    })

    it('should auto-resolve description conflicts (local wins)', async () => {
      const conflicts: ConflictItem[] = [
        {
          id: 'item-1',
          type: 'content',
          field: 'description',
          local: {
            data: { description: 'Local Description' },
            timestamp: '2024-01-01T00:00:00Z',
            version: 1
          },
          server: {
            data: { description: 'Server Description' },
            timestamp: '2024-01-01T00:01:00Z',
            version: 1
          }
        }
      ]

      const resolutions = await conflictResolver.resolveConflicts(conflicts)

      expect(resolutions).toHaveLength(1)
      expect(resolutions[0].resolution.strategy).toBe('keep_local')
      expect(resolutions[0].resolution.resolvedData).toEqual(conflicts[0].local.data)
    })

    it('should require manual resolution for critical content conflicts', async () => {
      const conflicts: ConflictItem[] = [
        {
          id: 'item-1',
          type: 'content',
          field: 'name', // Critical field
          local: {
            data: { name: 'Local Name' },
            timestamp: '2024-01-01T00:00:00Z',
            version: 1
          },
          server: {
            data: { name: 'Server Name' },
            timestamp: '2024-01-01T00:01:00Z',
            version: 1
          }
        }
      ]

      const resolutions = await conflictResolver.resolveConflicts(conflicts)

      expect(resolutions).toHaveLength(1)
      expect(resolutions[0].resolution.strategy).toBe('manual')
    })
  })

  describe('applyResolution', () => {
    it('should apply keep_local resolution', async () => {
      const conflict: ConflictItem = {
        id: 'item-1',
        type: 'content',
        field: 'name',
        local: {
          data: { name: 'Local Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: { name: 'Server Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:01:00Z',
          version: 2
        }
      }

      const resolution: Resolution = {
        strategy: 'keep_local',
        resolvedData: conflict.local.data
      }

      mockedSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as any)

      mockedOfflineStore.saveItems.mockResolvedValue(undefined)

      await conflictResolver.applyResolution(conflict, resolution)

      expect(mockedSupabase.from).toHaveBeenCalledWith('items')
      expect(mockedOfflineStore.saveItems).toHaveBeenCalled()
    })

    it('should apply keep_server resolution and update local store', async () => {
      const conflict: ConflictItem = {
        id: 'item-1',
        type: 'version',
        field: 'version',
        local: {
          data: { name: 'Local Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: { name: 'Server Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:01:00Z',
          version: 2
        }
      }

      const resolution: Resolution = {
        strategy: 'keep_server',
        resolvedData: conflict.server.data
      }

      mockedOfflineStore.saveItems.mockResolvedValue(undefined)

      await conflictResolver.applyResolution(conflict, resolution)

      // Should update local store with server data
      expect(mockedOfflineStore.saveItems).toHaveBeenCalled()
      const savedItem = mockedOfflineStore.saveItems.mock.calls[0][0][0]
      expect(savedItem.version).toBe(conflict.server.version)
    })

    it('should apply merge resolution', async () => {
      const conflict: ConflictItem = {
        id: 'item-1',
        type: 'content',
        field: 'description',
        local: {
          data: { name: 'Local Name', description: 'Local Description', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: { name: 'Server Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:01:00Z',
          version: 2
        }
      }

      const resolution: Resolution = {
        strategy: 'merge',
        resolvedData: {
          ...conflict.server.data,
          description: conflict.local.data.description
        }
      }

      mockedSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as any)

      mockedOfflineStore.saveItems.mockResolvedValue(undefined)

      await conflictResolver.applyResolution(conflict, resolution)

      expect(mockedSupabase.from).toHaveBeenCalledWith('items')
      expect(mockedOfflineStore.saveItems).toHaveBeenCalled()
    })

    it('should handle manual resolution with user choice', async () => {
      const conflict: ConflictItem = {
        id: 'item-1',
        type: 'content',
        field: 'name',
        local: {
          data: { name: 'Local Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: { name: 'Server Name', account_id: 'acc-123' },
          timestamp: '2024-01-01T00:01:00Z',
          version: 2
        }
      }

      const resolution: Resolution = {
        strategy: 'manual',
        userChoice: 'local',
        resolvedData: conflict.local.data
      }

      mockedSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as any)

      mockedOfflineStore.saveItems.mockResolvedValue(undefined)

      await conflictResolver.applyResolution(conflict, resolution)

      expect(mockedSupabase.from).toHaveBeenCalledWith('items')
      expect(mockedOfflineStore.saveItems).toHaveBeenCalled()
    })

    it('should convert camelCase to snake_case for database updates', async () => {
      const conflict: ConflictItem = {
        id: 'item-1',
        type: 'content',
        field: 'name',
        local: {
          data: {
            itemId: 'item-1',
            accountId: 'acc-123',
            projectId: 'proj-123',
            name: 'Test Item',
            purchasePrice: '100.00'
          },
          timestamp: '2024-01-01T00:00:00Z',
          version: 1
        },
        server: {
          data: {
            item_id: 'item-1',
            account_id: 'acc-123',
            project_id: 'proj-123',
            name: 'Test Item',
            purchase_price: '100.00'
          },
          timestamp: '2024-01-01T00:01:00Z',
          version: 2
        }
      }

      const resolution: Resolution = {
        strategy: 'keep_local',
        resolvedData: conflict.local.data
      }

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })

      mockedSupabase.from.mockReturnValue({
        update: updateMock
      } as any)

      mockedOfflineStore.saveItems.mockResolvedValue(undefined)

      await conflictResolver.applyResolution(conflict, resolution)

      // Check that update was called with snake_case fields
      const updateCall = updateMock.mock.calls[0][0]
      expect(updateCall).toHaveProperty('item_id')
      expect(updateCall).toHaveProperty('account_id')
      expect(updateCall).toHaveProperty('project_id')
      expect(updateCall).toHaveProperty('purchase_price')
    })
  })
})
