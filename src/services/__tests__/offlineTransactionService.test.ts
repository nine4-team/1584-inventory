import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OfflineTransactionService, OfflineStorageError, MissingOfflinePrerequisiteError } from '../offlineTransactionService'
import { offlineStore } from '../offlineStore'
import { operationQueue } from '../operationQueue'
import { offlineItemService } from '../offlineItemService'
import { getCachedBudgetCategoryById, getCachedTaxPresetById } from '../offlineMetadataService'

vi.mock('../offlineStore')
vi.mock('../operationQueue', () => ({
  operationQueue: {
    add: vi.fn(),
    processQueue: vi.fn(),
    removeOperation: vi.fn()
  }
}))
vi.mock('../offlineItemService', () => ({
  offlineItemService: {
    createItem: vi.fn()
  }
}))
vi.mock('../offlineMetadataService', () => ({
  getCachedBudgetCategoryById: vi.fn(),
  getCachedTaxPresetById: vi.fn()
}))
vi.mock('../networkStatusService', () => ({
  isNetworkOnline: vi.fn(() => false)
}))

const mockedOfflineStore = vi.mocked(offlineStore)
const mockedOperationQueue = vi.mocked(operationQueue)
const mockedOfflineItemService = vi.mocked(offlineItemService)
const mockedGetCachedBudgetCategoryById = vi.mocked(getCachedBudgetCategoryById)
const mockedGetCachedTaxPresetById = vi.mocked(getCachedTaxPresetById)

const service = new OfflineTransactionService()

describe('OfflineTransactionService.createTransaction', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.saveTransactions.mockReset()
    mockedOfflineStore.deleteTransaction.mockReset()
    mockedOperationQueue.add.mockReset()
    mockedOperationQueue.processQueue.mockReset()
    mockedOperationQueue.removeOperation.mockReset()
    mockedOfflineItemService.createItem.mockReset()
    mockedGetCachedBudgetCategoryById.mockReset()
    mockedGetCachedTaxPresetById.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.saveTransactions.mockResolvedValue()
    mockedOfflineStore.deleteTransaction.mockResolvedValue(undefined)
    mockedOperationQueue.add.mockResolvedValue('op-123')
    mockedOperationQueue.processQueue.mockResolvedValue(undefined)
    mockedOperationQueue.removeOperation.mockResolvedValue(true)
    mockedGetCachedBudgetCategoryById.mockResolvedValue({ id: 'cat-1', name: 'Test Category' } as any)
    mockedGetCachedTaxPresetById.mockResolvedValue({ id: 'preset-1', rate: 0.08 } as any)
  })

  it('persists the optimistic transaction before queueing the operation', async () => {
    const callOrder: string[] = []
    mockedOfflineStore.saveTransactions.mockImplementation(async () => {
      callOrder.push('save')
    })
    mockedOperationQueue.add.mockImplementation(async () => {
      callOrder.push('queue')
      return 'op-queued'
    })

    const result = await service.createTransaction('acc-1', 'proj-1', {
      transactionDate: '2024-01-01',
      source: 'Test Source',
      amount: '100.00',
      categoryId: 'cat-1'
    } as any)

    expect(callOrder).toEqual(['save', 'queue'])
    expect(result.operationId).toBe('op-queued')
    expect(result.transactionId).toBeDefined()
    expect(result.transactionId).toMatch(/^T-\d+-[a-z0-9]+$/)
  })

  it('throws OfflineStorageError when offline store init fails', async () => {
    mockedOfflineStore.init.mockRejectedValueOnce(new Error('init failed'))

    await expect(
      service.createTransaction('acc-1', 'proj-1', {
        transactionDate: '2024-01-01',
        source: 'Test Source',
        amount: '100.00'
      } as any)
    ).rejects.toBeInstanceOf(OfflineStorageError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
  })

  it('throws MissingOfflinePrerequisiteError when budget category is not cached', async () => {
    mockedGetCachedBudgetCategoryById.mockResolvedValueOnce(null)

    await expect(
      service.createTransaction('acc-1', 'proj-1', {
        transactionDate: '2024-01-01',
        source: 'Test Source',
        amount: '100.00',
        categoryId: 'missing-cat'
      } as any)
    ).rejects.toBeInstanceOf(MissingOfflinePrerequisiteError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
    expect(mockedOfflineStore.saveTransactions).not.toHaveBeenCalled()
  })

  it('throws MissingOfflinePrerequisiteError when tax preset is not cached', async () => {
    mockedGetCachedTaxPresetById.mockResolvedValueOnce(null)

    await expect(
      service.createTransaction('acc-1', 'proj-1', {
        transactionDate: '2024-01-01',
        source: 'Test Source',
        amount: '100.00',
        taxRatePreset: 'missing-preset'
      } as any)
    ).rejects.toBeInstanceOf(MissingOfflinePrerequisiteError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
    expect(mockedOfflineStore.saveTransactions).not.toHaveBeenCalled()
  })

  it('does not validate tax preset when set to "Other"', async () => {
    await service.createTransaction('acc-1', 'proj-1', {
      transactionDate: '2024-01-01',
      source: 'Test Source',
      amount: '100.00',
      taxRatePreset: 'Other'
    } as any)

    expect(mockedGetCachedTaxPresetById).not.toHaveBeenCalled()
    expect(mockedOperationQueue.add).toHaveBeenCalled()
  })

  it('rolls back the optimistic transaction when queueing fails', async () => {
    mockedOperationQueue.add.mockRejectedValueOnce(new Error('queue write failed'))

    await expect(
      service.createTransaction('acc-1', 'proj-1', {
        transactionDate: '2024-01-01',
        source: 'Test Source',
        amount: '100.00'
      } as any)
    ).rejects.toThrow('queue write failed')

    expect(mockedOfflineStore.deleteTransaction).toHaveBeenCalledTimes(1)
  })

  it('creates child items when provided', async () => {
    mockedOfflineItemService.createItem.mockResolvedValue({ operationId: 'item-op-1', wasQueued: true } as any)

    const items = [
      { description: 'Item 1', purchasePrice: '50.00' },
      { description: 'Item 2', purchasePrice: '50.00' }
    ] as any[]

    const result = await service.createTransaction('acc-1', 'proj-1', {
      transactionDate: '2024-01-01',
      source: 'Test Source',
      amount: '100.00'
    } as any, items)

    expect(mockedOfflineItemService.createItem).toHaveBeenCalledTimes(2)
    expect(result.transactionId).toBeDefined()
    
    // Verify items were created with the optimistic transaction ID
    const itemCalls = mockedOfflineItemService.createItem.mock.calls
    expect(itemCalls[0][1].transactionId).toBe(result.transactionId)
    expect(itemCalls[1][1].transactionId).toBe(result.transactionId)
  })

  it('removes queued transaction operation if child item creation fails', async () => {
    mockedOfflineItemService.createItem.mockRejectedValueOnce(new Error('child fail'))

    await expect(
      service.createTransaction('acc-1', 'proj-1', {
        transactionDate: '2024-01-01',
        source: 'Test Source',
        amount: '100.00'
      } as any, [{ description: 'Item 1', purchasePrice: '50.00' } as any])
    ).rejects.toThrow('child fail')

    expect(mockedOperationQueue.removeOperation).toHaveBeenCalledTimes(1)
    expect(mockedOperationQueue.removeOperation).toHaveBeenCalledWith('op-123')
  })
})

describe('OfflineTransactionService.updateTransaction', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.getTransactionById.mockReset()
    mockedOfflineStore.saveTransactions.mockReset()
    mockedOperationQueue.add.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.getTransactionById.mockResolvedValue({
      transactionId: 'tx-1',
      accountId: 'acc-1',
      projectId: 'proj-1',
      amount: '100.00',
      version: 1
    } as any)
    mockedOfflineStore.saveTransactions.mockResolvedValue()
    mockedOperationQueue.add.mockResolvedValue('op-update-123')
  })

  it('loads existing transaction from offline store before updating', async () => {
    await service.updateTransaction('acc-1', 'tx-1', {
      amount: '150.00'
    } as any)

    expect(mockedOfflineStore.getTransactionById).toHaveBeenCalledWith('tx-1')
    expect(mockedOperationQueue.add).toHaveBeenCalled()
  })

  it('throws error when transaction not found in offline store', async () => {
    mockedOfflineStore.getTransactionById.mockResolvedValueOnce(null)

    await expect(
      service.updateTransaction('acc-1', 'tx-1', { amount: '150.00' } as any)
    ).rejects.toThrow('not found in offline store')
  })
})

describe('OfflineTransactionService.deleteTransaction', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.getTransactionById.mockReset()
    mockedOperationQueue.add.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.getTransactionById.mockResolvedValue({
      transactionId: 'tx-1',
      accountId: 'acc-1',
      projectId: 'proj-1',
      amount: '100.00',
      version: 1
    } as any)
    mockedOperationQueue.add.mockResolvedValue('op-delete-123')
  })

  it('queues delete operation for existing transaction', async () => {
    const result = await service.deleteTransaction('acc-1', 'tx-1')

    expect(mockedOfflineStore.getTransactionById).toHaveBeenCalledWith('tx-1')
    expect(mockedOperationQueue.add).toHaveBeenCalled()
    expect(result.operationId).toBe('op-delete-123')
  })

  it('throws error when transaction not found in offline store', async () => {
    mockedOfflineStore.getTransactionById.mockResolvedValueOnce(null)

    await expect(
      service.deleteTransaction('acc-1', 'tx-1')
    ).rejects.toThrow('not found in offline store')
  })
})
