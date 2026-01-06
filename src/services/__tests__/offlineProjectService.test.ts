import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OfflineProjectService, OfflineStorageError } from '../offlineProjectService'
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
vi.mock('../networkStatusService', () => ({
  isNetworkOnline: vi.fn(() => false)
}))

const mockedOfflineStore = vi.mocked(offlineStore)
const mockedOperationQueue = vi.mocked(operationQueue)

const service = new OfflineProjectService()

describe('OfflineProjectService.createProject', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.saveProjects.mockReset()
    mockedOfflineStore.deleteProject.mockReset()
    mockedOperationQueue.add.mockReset()
    mockedOperationQueue.processQueue.mockReset()
    mockedOperationQueue.removeOperation.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.saveProjects.mockResolvedValue()
    mockedOfflineStore.deleteProject.mockResolvedValue(undefined)
    mockedOperationQueue.add.mockResolvedValue('op-123')
    mockedOperationQueue.processQueue.mockResolvedValue(undefined)
    mockedOperationQueue.removeOperation.mockResolvedValue(true)
  })

  it('persists the optimistic project before queueing the operation', async () => {
    const callOrder: string[] = []
    mockedOfflineStore.saveProjects.mockImplementation(async () => {
      callOrder.push('save')
    })
    mockedOperationQueue.add.mockImplementation(async () => {
      callOrder.push('queue')
      return 'op-queued'
    })

    const result = await service.createProject('acc-1', {
      name: 'Test Project',
      clientName: 'Test Client',
      description: 'Test Description'
    } as any)

    expect(callOrder).toEqual(['save', 'queue'])
    expect(result.operationId).toBe('op-queued')
    expect(result.projectId).toBeDefined()
    expect(result.projectId).toMatch(/^P-\d+-[a-z0-9]+$/)
  })

  it('throws OfflineStorageError when offline store init fails', async () => {
    mockedOfflineStore.init.mockRejectedValueOnce(new Error('init failed'))

    await expect(
      service.createProject('acc-1', {
        name: 'Test Project',
        clientName: 'Test Client'
      } as any)
    ).rejects.toBeInstanceOf(OfflineStorageError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
  })

  it('does not enqueue an operation if saving to IndexedDB fails', async () => {
    mockedOfflineStore.saveProjects.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(
      service.createProject('acc-1', {
        name: 'Test Project',
        clientName: 'Test Client'
      } as any)
    ).rejects.toBeInstanceOf(OfflineStorageError)

    expect(mockedOperationQueue.add).not.toHaveBeenCalled()
    expect(mockedOfflineStore.deleteProject).not.toHaveBeenCalled()
  })

  it('rolls back the optimistic project when queueing fails', async () => {
    mockedOperationQueue.add.mockRejectedValueOnce(new Error('queue write failed'))

    await expect(
      service.createProject('acc-1', {
        name: 'Test Project',
        clientName: 'Test Client'
      } as any)
    ).rejects.toThrow('queue write failed')

    expect(mockedOfflineStore.deleteProject).toHaveBeenCalledTimes(1)
  })

  it('saves project with all fields including budget categories', async () => {
    const projectData = {
      name: 'Test Project',
      clientName: 'Test Client',
      description: 'Test Description',
      budget: 10000,
      designFee: 2000,
      budgetCategories: { 'cat-1': 5000, 'cat-2': 5000 }
    } as any

    await service.createProject('acc-1', projectData)

    expect(mockedOfflineStore.saveProjects).toHaveBeenCalled()
    const savedProject = mockedOfflineStore.saveProjects.mock.calls[0][0][0]
    expect(savedProject.name).toBe('Test Project')
    expect(savedProject.budget).toBe(10000)
  })
})

describe('OfflineProjectService.updateProject', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.getProjectById.mockReset()
    mockedOfflineStore.saveProjects.mockReset()
    mockedOperationQueue.add.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.getProjectById.mockResolvedValue({
      id: 'proj-1',
      accountId: 'acc-1',
      name: 'Original Project',
      version: 1
    } as any)
    mockedOfflineStore.saveProjects.mockResolvedValue()
    mockedOperationQueue.add.mockResolvedValue('op-update-123')
  })

  it('loads existing project from offline store before updating', async () => {
    await service.updateProject('acc-1', 'proj-1', {
      name: 'Updated Project'
    } as any)

    expect(mockedOfflineStore.getProjectById).toHaveBeenCalledWith('proj-1')
    expect(mockedOperationQueue.add).toHaveBeenCalled()
  })

  it('throws error when project not found in offline store', async () => {
    mockedOfflineStore.getProjectById.mockResolvedValueOnce(null)

    await expect(
      service.updateProject('acc-1', 'proj-1', { name: 'Updated Project' } as any)
    ).rejects.toThrow('not found in offline store')
  })

  it('increments version number on update', async () => {
    await service.updateProject('acc-1', 'proj-1', {
      name: 'Updated Project'
    } as any)

    const operation = mockedOperationQueue.add.mock.calls[0][0]
    expect(operation.data.updates.version).toBe(2)
  })
})

describe('OfflineProjectService.deleteProject', () => {
  beforeEach(() => {
    mockedOfflineStore.init.mockReset()
    mockedOfflineStore.getProjectById.mockReset()
    mockedOperationQueue.add.mockReset()

    mockedOfflineStore.init.mockResolvedValue()
    mockedOfflineStore.getProjectById.mockResolvedValue({
      id: 'proj-1',
      accountId: 'acc-1',
      name: 'Test Project',
      version: 1
    } as any)
    mockedOperationQueue.add.mockResolvedValue('op-delete-123')
  })

  it('queues delete operation for existing project', async () => {
    const result = await service.deleteProject('acc-1', 'proj-1')

    expect(mockedOfflineStore.getProjectById).toHaveBeenCalledWith('proj-1')
    expect(mockedOperationQueue.add).toHaveBeenCalled()
    expect(result.operationId).toBe('op-delete-123')
  })

  it('throws error when project not found in offline store', async () => {
    mockedOfflineStore.getProjectById.mockResolvedValueOnce(null)

    await expect(
      service.deleteProject('acc-1', 'proj-1')
    ).rejects.toThrow('not found in offline store')
  })
})
