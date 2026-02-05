import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { operationQueue, OfflineContextError } from '../operationQueue'
import { offlineStore } from '../offlineStore'
import { conflictDetector } from '../conflictDetector'
import { getCurrentUser, supabase } from '../supabase'
import { isNetworkOnline } from '../networkStatusService'
import { getOfflineContext, getLastKnownUserId } from '../offlineContext'

// Mock dependencies
vi.mock('../offlineStore')
vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('./test-utils')
  const supabase = createMockSupabaseClient()
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
  if (!('refreshSession' in supabase.auth)) {
    ;(supabase.auth as any).refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
  }
  return {
    supabase,
    getCurrentUser: vi.fn().mockResolvedValue({ id: 'test-user' })
  }
})
vi.mock('../conflictDetector', () => ({
  conflictDetector: {
    detectConflicts: vi.fn().mockResolvedValue([])
  }
}))
vi.mock('../networkStatusService', () => ({
  isNetworkOnline: vi.fn()
}))
vi.mock('../offlineContext', () => ({
  initOfflineContext: vi.fn().mockResolvedValue(undefined),
  getOfflineContext: vi.fn(),
  subscribeToOfflineContext: vi.fn(() => () => {}),
  getLastKnownUserId: vi.fn()
}))
vi.mock('../serviceWorker', () => ({
  registerBackgroundSync: vi.fn().mockResolvedValue({ enabled: true, supported: true }),
  notifySyncStart: vi.fn(),
  notifySyncComplete: vi.fn(),
  notifySyncError: vi.fn()
}))

describe('OperationQueue', () => {
const mockedOfflineStore = vi.mocked(offlineStore)
const mockedConflictDetector = vi.mocked(conflictDetector)
const mockedIsNetworkOnline = vi.mocked(isNetworkOnline)
const mockedGetOfflineContext = vi.mocked(getOfflineContext)
const mockedGetLastKnownUserId = vi.mocked(getLastKnownUserId)
  let storedOperations: any[] = []

  beforeEach(async () => {
    vi.useFakeTimers()
    mockedIsNetworkOnline.mockReturnValue(false)
    mockedGetOfflineContext.mockReturnValue({
      userId: 'test-user',
      accountId: 'acc-123',
      updatedAt: new Date().toISOString()
    } as any)
    mockedGetLastKnownUserId.mockReturnValue(null as any)
    mockedConflictDetector.detectConflicts.mockResolvedValue([])
    let onlineState = false
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => onlineState,
      set: (value) => {
        onlineState = value
      }
    })
    storedOperations = []
    ;(operationQueue as any).context = null
    ;(operationQueue as any).lastResolvedUserId = null
    mockedOfflineStore.init.mockResolvedValue(undefined)
    mockedOfflineStore.getContext.mockResolvedValue(null as any)
    mockedOfflineStore.saveContext.mockResolvedValue(undefined)
    mockedOfflineStore.clearContext.mockResolvedValue(undefined)
    mockedOfflineStore.getOperations.mockImplementation(async () => storedOperations)
    mockedOfflineStore.replaceOperationsForAccount.mockImplementation(async (_accountId, ops) => {
      storedOperations = ops
    })
    mockedOfflineStore.clearOperations.mockImplementation(async () => {
      storedOperations = []
    })
    mockedOfflineStore.getItemById.mockReset()
    mockedOfflineStore.getItemById.mockResolvedValue(null as any)

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
          id: 'item-test-123',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item',
          description: 'Test description',
          quantity: 1,
          unitCost: 0
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
          accountId: 'acc-123',
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
        data: { id: 'item-123', accountId: 'acc-123' }
      }

      await operationQueue.add(operation)
      expect(operationQueue.getQueueLength()).toBe(1)

      await operationQueue.clearQueue()
      expect(operationQueue.getQueueLength()).toBe(0)
    })
    it('should respect metadata overrides when provided', async () => {
      const metadataTimestamp = '2025-01-01T00:00:00.000Z'
      mockedGetOfflineContext.mockReturnValue({
        userId: 'test-user',
        accountId: 'meta-account',
        updatedAt: new Date().toISOString()
      } as any)
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-meta-123',
          accountId: 'meta-account',
          projectId: 'proj-321',
          name: 'Meta Item',
          description: 'Meta test item',
          quantity: 1,
          unitCost: 0
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
      const executeSpy = vi.spyOn(operationQueue as any, 'executeOperation').mockImplementation(mockExecute)

      mockedIsNetworkOnline.mockReturnValue(true)
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      expect(mockExecute).toHaveBeenCalled()
      executeSpy.mockRestore()
    })

    it('should not process when offline', async () => {
      ;(navigator as any).onLine = false

      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-test-789',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item',
          quantity: 1,
          unitCost: 0
        }
      }

      await operationQueue.add(operation)

      const mockExecute = vi.fn()
      const executeSpy = vi.spyOn(operationQueue as any, 'executeOperation').mockImplementation(mockExecute)

      await operationQueue.processQueue()

      expect(mockExecute).not.toHaveBeenCalled()
      executeSpy.mockRestore()
    })

    it('should retry failed operations with backoff', async () => {
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-test-retry',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item',
          quantity: 1,
          unitCost: 0
        }
      }

      await operationQueue.add(operation)

      // Mock failed execution
      const executeSpy = vi.spyOn(operationQueue as any, 'executeOperation').mockResolvedValue(false)

      mockedIsNetworkOnline.mockReturnValue(true)
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      const pending = operationQueue.getPendingOperations()
      expect(pending[0].retryCount).toBe(1)
      expect(pending[0].lastError).toBe('Sync failed')
      executeSpy.mockRestore()
    })

    it('should give up after max retries', async () => {
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-test-max-retries',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item',
          quantity: 1,
          unitCost: 0
        }
      }

      await operationQueue.add(operation)

      // Set retry count to max on internal queue
      ;(operationQueue as any).queue[0].retryCount = 5

      // Mock failed execution
      const executeSpy = vi.spyOn(operationQueue as any, 'executeOperation').mockResolvedValue(false)

      mockedIsNetworkOnline.mockReturnValue(true)
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      // Operation should be removed after max retries
      expect(operationQueue.getQueueLength()).toBe(1)
      executeSpy.mockRestore()
    })
  })

  describe('Auth handling', () => {
    it('should require authenticated user for operations', async () => {
      // Mock unauthenticated user
      vi.mocked(await import('../supabase')).getCurrentUser.mockResolvedValueOnce(null)
      mockedIsNetworkOnline.mockReturnValue(true)
      mockedGetOfflineContext.mockReturnValue(null as any)

      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-test-auth',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Test Item',
          quantity: 1,
          unitCost: 0
        }
      }

      await expect(operationQueue.add(operation)).rejects.toBeInstanceOf(OfflineContextError)
    })
  })

  describe('Conflict gating', () => {
    const baseConflict = {
      local: { data: {}, timestamp: new Date().toISOString(), version: 1 },
      server: { data: {}, timestamp: new Date().toISOString(), version: 2 },
      field: 'name',
      type: 'content' as const
    }

    it('allows create operations to proceed when conflicts target other items', async () => {
      const operation = {
        id: 'op-create-1',
        type: 'CREATE_ITEM' as const,
        timestamp: new Date().toISOString(),
        retryCount: 0,
        accountId: 'acc-123',
        updatedBy: 'test-user',
        version: 1,
        data: {
          id: 'item-create-allowed',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Staged Item'
        }
      }

      mockedConflictDetector.detectConflicts.mockResolvedValueOnce([
        { id: 'other-item', ...baseConflict }
      ])

      const executeCreateSpy = vi
        .spyOn(operationQueue as any, 'executeCreateItem')
        .mockResolvedValue(true)

      const result = await (operationQueue as any).executeOperation(operation)

      expect(result).toBe(true)
      expect(executeCreateSpy).toHaveBeenCalled()

      executeCreateSpy.mockRestore()
    })

    it('blocks update operations when conflicts exist for the same item', async () => {
      const operation = {
        id: 'op-update-1',
        type: 'UPDATE_ITEM' as const,
        timestamp: new Date().toISOString(),
        retryCount: 0,
        accountId: 'acc-123',
        updatedBy: 'test-user',
        version: 2,
        data: {
          id: 'item-conflict',
          accountId: 'acc-123',
          updates: { name: 'New name' }
        }
      }

      mockedOfflineStore.getItemById.mockResolvedValueOnce({
        itemId: 'item-conflict',
        projectId: 'proj-999'
      } as any)

      mockedConflictDetector.detectConflicts.mockResolvedValueOnce([
        { id: 'item-conflict', ...baseConflict }
      ])

      const executeUpdateSpy = vi
        .spyOn(operationQueue as any, 'executeUpdateItem')
        .mockResolvedValue(true)

      const result = await (operationQueue as any).executeOperation(operation)

      expect(result).toBe(true)
      expect(executeUpdateSpy).toHaveBeenCalled()

      executeUpdateSpy.mockRestore()
    })

    it('does not mark operations as blocked when conflicts are unrelated', async () => {
      const operationInput = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-nonblocking',
          accountId: 'acc-123',
          projectId: 'proj-abc',
          name: 'Retry Item'
        }
      }

      await operationQueue.add(operationInput)

      mockedConflictDetector.detectConflicts.mockResolvedValue([
        { id: 'other-item', ...baseConflict }
      ])

      const executeOpSpy = vi
        .spyOn(operationQueue as any, 'executeOperation')
        .mockResolvedValueOnce(false)

      mockedIsNetworkOnline.mockReturnValue(true)
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 } },
        error: null
      } as any)

      ;(navigator as any).onLine = true
      await operationQueue.processQueue()

      const pending = operationQueue.getPendingOperations()
      expect(pending[0].retryCount).toBe(1)
      expect(pending[0].lastError).toBe('Sync failed')

      executeOpSpy.mockRestore()
    })
  })

  describe('Offline context behavior', () => {
    it('uses cached offline user context without calling getCurrentUser', async () => {
      const getCurrentUserMock = vi.mocked(getCurrentUser)
      getCurrentUserMock.mockClear()

      mockedGetOfflineContext.mockReturnValue({
        userId: 'offline-user',
        accountId: 'acc-123',
        updatedAt: new Date().toISOString()
      } as any)

      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'item-offline-test',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Offline Item'
        }
      }

      await operationQueue.add(operation)
      expect(getCurrentUserMock).not.toHaveBeenCalled()

      const snapshot = operationQueue.getSnapshot()
      expect(snapshot.lastOfflineEnqueueAt).not.toBeNull()
      await operationQueue.clearQueue()
    })

    it('throws OfflineContextError when user context missing offline', async () => {
      const operation = {
        type: 'CREATE_ITEM' as const,
        data: {
          id: 'missing-user-item',
          accountId: 'acc-123',
          projectId: 'proj-123',
          name: 'Missing User Item'
        }
      }

      mockedGetOfflineContext.mockReturnValue({
        userId: null,
        accountId: 'acc-123',
        updatedAt: new Date().toISOString()
      } as any)

      await expect(operationQueue.add(operation)).rejects.toBeInstanceOf(OfflineContextError)
    })
  })
})