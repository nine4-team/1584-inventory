import { describe, it, expect, beforeEach, vi } from 'vitest'
import { offlineItemService, OfflineStorageError } from '../offlineItemService'
import { offlineStore } from '../offlineStore'
import { operationQueue } from '../operationQueue'

vi.mock('../offlineStore')
vi.mock('../operationQueue', () => ({
  operationQueue: {
    add: vi.fn(),
    processQueue: vi.fn(),
    removeOperation: vi.fn()
  }
}))

const mockedOfflineStore = vi.mocked(offlineStore)
const mockedOperationQueue = vi.mocked(operationQueue)

describe('offlineItemService.createItem', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.saveItems.mockReset()
    mockedOfflineStore.deleteItem.mockReset()
    mockedOperationQueue.add.mockReset()
    mockedOperationQueue.processQueue.mockReset()
    mockedOperationQueue.removeOperation.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.saveItems.mockResolvedValue()
    mockedOfflineStore.deleteItem.mockResolvedValue(undefined)
    mockedOperationQueue.add.mockResolvedValue('op-123')
    mockedOperationQueue.processQueue.mockResolvedValue(undefined)
    mockedOperationQueue.removeOperation.mockResolvedValue(true)

    let onlineState = false
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => onlineState,
      set: (value) => {
        onlineState = value
      }
    })
    ;(navigator as any).onLine = false
  })

  it('persists the optimistic item before queueing the operation', async () => {
    const callOrder: string[] = []
    mockedOfflineStore.saveItems.mockImplementation(async () => {
      callOrder.push('save')
    })
    mockedOperationQueue.add.mockImplementation(async () => {
      callOrder.push('queue')
      return 'op-queued'
    })

    const result = await offlineItemService.createItem('acc-1', {
      projectId: 'proj-1',
      name: 'Offline Item'
    } as any)

    expect(callOrder).toEqual(['save', 'queue'])
    expect(result.operationId).toBe('op-queued')
  })

  it('defaults the disposition to purchased when omitted', async () => {
    await offlineItemService.createItem('acc-1', {
      projectId: 'proj-1',
      name: 'Offline Item'
    } as any)

    const savedItem = mockedOfflineStore.saveItems.mock.calls[0][0][0]
    expect(savedItem.disposition).toBe('purchased')
  })

  it('throws OfflineStorageError when offline store init fails', async () => {
    mockedOfflineStore.init.mockRejectedValueOnce(new Error('init failed'))

    await expect(
      offlineItemService.createItem('acc-1', { projectId: 'proj-1', name: 'Init fail' } as any)
    ).rejects.toBeInstanceOf(OfflineStorageError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
  })

  it('does not enqueue an operation if saving to IndexedDB fails', async () => {
    mockedOfflineStore.saveItems.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(
      offlineItemService.createItem('acc-1', { projectId: 'proj-1', name: 'Save fail' } as any)
    ).rejects.toBeInstanceOf(OfflineStorageError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
    expect(mockedOfflineStore.deleteItem).not.toHaveBeenCalled()
  })

  it('rolls back the optimistic item when queueing fails', async () => {
    mockedOperationQueue.add.mockRejectedValueOnce(new Error('queue write failed'))

    await expect(
      offlineItemService.createItem('acc-1', { projectId: 'proj-1', name: 'Queue fail' } as any)
    ).rejects.toThrow('queue write failed')

    expect(mockedOfflineStore.deleteItem).toHaveBeenCalledTimes(1)
  })
})
