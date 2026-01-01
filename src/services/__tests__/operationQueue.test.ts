import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { operationQueue } from '../operationQueue'
import { offlineStore } from '../offlineStore'

// Mock dependencies
vi.mock('../offlineStore')
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
    }
  },
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'test-user' })
}))
vi.mock('../conflictDetector', () => ({
  conflictDetector: {
    detectConflicts: vi.fn().mockResolvedValue([])
  }
}))

describe('OperationQueue', () => {
  const mockedOfflineStore = vi.mocked(offlineStore)
  let storedOperations: any[] = []

  beforeEach(async () => {
    vi.useFakeTimers()
    let onlineState = false
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => onlineState,
      set: (value) => {
        onlineState = value
      }
    })
    storedOperations = []
    mockedOfflineStore.getOperations.mockImplementation(async () => storedOperations)
    mockedOfflineStore.saveOperations.mockImplementation(async (ops) => {
      storedOperations = ops
    })
    mockedOfflineStore.clearOperations.mockImplementation(async () => {
      storedOperations = []
    })

    ;(navigator as any).onLine = false

    // Clear queue before each test
    await operationQueue.clearQueue()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Queue management', () => {
    it('should add operations to queue', async () => {
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item',
          description: 'Test description'
        }
      }

      await operationQueue.add(operation)

      const pending = operationQueue.getPendingOperations()
      expect(pending).toHaveLength(1)
      expect(pending[0].type).toBe('CREATE_ITEM')
      expect(pending[0].accountId).toBeDefined()
      expect(pending[0].updatedBy).toBe('test-user')
      expect(pending[0].version).toBe(1)
    })

    it('should persist queue to IndexedDB', async () => {
      const operation = {
        type: 'UPDATE_ITEM' as const,
        data: {
          id: 'item-123',
          updates: { name: 'Updated Name' }
        }
      }

      await operationQueue.add(operation)

      // Re-initialize to test persistence
      await operationQueue.init()
      const pending = operationQueue.getPendingOperations()

      expect(pending).toHaveLength(1)
    })

    it('should clear queue', async () => {
      const operation = {
        type: 'DELETE_ITEM' as const,
        data: { id: 'item-123' }
      }

      await operationQueue.add(operation)
      expect(operationQueue.getQueueLength()).toBe(1)

      await operationQueue.clearQueue()
      expect(operationQueue.getQueueLength()).toBe(0)
    })
    it('should respect metadata overrides when provided', async () => {
      const metadataTimestamp = '2025-01-01T00:00:00.000Z'
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'meta-account',
          projectId: 'proj-321',
          name: 'Meta Item',
          description: 'Meta test item'
        }
      }

      await operationQueue.add(operation, {
        accountId: 'meta-account',
        version: 5,
        timestamp: metadataTimestamp
      })

      const pending = operationQueue.getPendingOperations()
      expect(pending[0].accountId).toBe('meta-account')
      expect(pending[0].version).toBe(5)
      expect(pending[0].timestamp).toBe(metadataTimestamp)
    })
  })

  describe('Operation processing', () => {
    it('should process operations when online', async () => {
      // Mock navigator.onLine
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item'
        }
      }

      await operationQueue.add(operation)

      // Mock successful execution
      const mockExecute = vi.fn().mockResolvedValue(true)
      vi.spyOn(operationQueue as any, 'executeOperation').mockImplementation(mockExecute)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      expect(mockExecute).toHaveBeenCalled()
    })

    it('should not process when offline', async () => {
      ;(navigator as any).onLine = false

      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item'
        }
      }

      await operationQueue.add(operation)

      const mockExecute = vi.fn()
      vi.spyOn(operationQueue as any, 'executeOperation').mockImplementation(mockExecute)

      await operationQueue.processQueue()

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('should retry failed operations with backoff', async () => {
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item'
        }
      }

      await operationQueue.add(operation)

      // Mock failed execution
      vi.spyOn(operationQueue as any, 'executeOperation').mockResolvedValue(false)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      const pending = operationQueue.getPendingOperations()
      expect(pending[0].retryCount).toBe(1)
      expect(pending[0].lastError).toBe('Sync failed')
    })

    it('should give up after max retries', async () => {
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item'
        }
      }

      await operationQueue.add(operation)

      // Set retry count to max on internal queue
      ;(operationQueue as any).queue[0].retryCount = 5

      // Mock failed execution
      vi.spyOn(operationQueue as any, 'executeOperation').mockResolvedValue(false)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      // Operation should be removed after max retries
      expect(operationQueue.getQueueLength()).toBe(0)
    })
  })

  describe('Auth handling', () => {
    it('should require authenticated user for operations', async () => {
      // Mock unauthenticated user
      vi.mocked(await import('../supabase')).getCurrentUser.mockResolvedValueOnce(null)

      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item'
        }
      }

      await expect(operationQueue.add(operation)).rejects.toThrow('User must be authenticated')
    })
  })
})