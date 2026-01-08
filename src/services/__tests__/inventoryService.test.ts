import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, createMockProject, createNotFoundError, createMockQueryBuilder } from './test-utils'

// Mock Supabase before importing services
vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('./test-utils')
  return {
    supabase: createMockSupabaseClient()
  }
})

// Mock databaseService
vi.mock('../databaseService', () => ({
  ensureAuthenticatedForDatabase: vi.fn().mockResolvedValue(undefined),
  convertTimestamps: vi.fn((data) => data)
}))

// Import after mocks are set up
import { projectService, transactionService, unifiedItemsService, auditService } from '../inventoryService'
import * as supabaseModule from '../supabase'

describe('projectService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProjects', () => {
    it('should return projects for account', async () => {
      const mockProjects = [
        createMockProject({ id: 'project-1', name: 'Project 1' }),
        createMockProject({ id: 'project-2', name: 'Project 2' })
      ]
      const mockQueryBuilder = createMockSupabaseClient().from('projects')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockProjects, error: null })
      } as any)

      const projects = await projectService.getProjects('test-account-id')
      expect(projects).toHaveLength(2)
      expect(projects[0].name).toBe('Project 1')
    })

    it('should return empty array when no projects', async () => {
      const mockQueryBuilder = createMockSupabaseClient().from('projects')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      } as any)

      const projects = await projectService.getProjects('test-account-id')
      expect(projects).toEqual([])
    })
  })

  describe('getProject', () => {
    it('should return project when found', async () => {
      const mockProject = createMockProject()
      const mockQueryBuilder = createMockSupabaseClient().from('projects')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockProject, error: null })
      } as any)

      const project = await projectService.getProject('test-account-id', 'test-project-id')
      expect(project).toBeTruthy()
      expect(project?.id).toBe('test-project-id')
    })

    it('should return null when project not found', async () => {
      const notFoundError = createNotFoundError()
      const mockQueryBuilder = createMockSupabaseClient().from('projects')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: notFoundError })
      } as any)

      const project = await projectService.getProject('test-account-id', 'non-existent-id')
      expect(project).toBeNull()
    })
  })

  describe('createProject', () => {
    it('should create a new project', async () => {
      const mockProject = createMockProject()
      const mockQueryBuilder = createMockSupabaseClient().from('projects')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: mockProject.id }, error: null })
      } as any)

      const projectData = {
        name: 'New Project',
        description: 'Description',
        clientName: 'Client',
        createdBy: 'user-id',
        accountId: 'test-account-id'
      }

      const projectId = await projectService.createProject('test-account-id', projectData as any)
      expect(projectId).toBe(mockProject.id)
    })

    it('should throw error on failure', async () => {
      const error = { code: '500', message: 'Server error', details: null, hint: null }
      const mockQueryBuilder = createMockSupabaseClient().from('projects')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error })
      } as any)

      const projectData = {
        name: 'New Project',
        createdBy: 'user-id',
        accountId: 'test-account-id'
      }

      await expect(
        projectService.createProject('test-account-id', projectData as any)
      ).rejects.toEqual(error)
    })
  })

  describe('updateProject', () => {
    it('should update project', async () => {
      // Create an awaitable chain object
      const awaitableChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((onResolve?: (value: any) => any) => {
          return Promise.resolve({ data: null, error: null }).then(onResolve)
        }),
        catch: vi.fn((onReject?: (error: any) => any) => {
          return Promise.resolve({ data: null, error: null }).catch(onReject)
        })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(awaitableChain as any)

      await expect(
        projectService.updateProject('test-account-id', 'test-project-id', { name: 'Updated Name' })
      ).resolves.not.toThrow()
    })
  })

  describe('deleteProject', () => {
    it('should delete project', async () => {
      // Create an awaitable chain object
      const awaitableChain = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((onResolve?: (value: any) => any) => {
          return Promise.resolve({ data: null, error: null }).then(onResolve)
        }),
        catch: vi.fn((onReject?: (error: any) => any) => {
          return Promise.resolve({ data: null, error: null }).catch(onReject)
        })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(awaitableChain as any)

      await expect(
        projectService.deleteProject('test-account-id', 'test-project-id')
      ).resolves.not.toThrow()
    })
  })
})

describe('transactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('_recomputeNeedsReview', () => {
    it('should never flag canonical sale transactions for review', async () => {
      const mockQueryBuilder = createMockSupabaseClient().from('transactions')

      // Mock the update query to capture what gets written
      let capturedNeedsReview: boolean | undefined
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        update: vi.fn((data: any) => {
          capturedNeedsReview = data.needs_review
          return {
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((onResolve) => {
              return Promise.resolve({ data: null, error: null }).then(onResolve)
            })
          }
        })
      } as any)

      // Test INV_SALE_ transaction
      await (transactionService as any)._recomputeNeedsReview('test-account', 'project-1', 'INV_SALE_project-1')

      expect(capturedNeedsReview).toBe(false)
    })

    it('should never flag canonical purchase transactions for review', async () => {
      const mockQueryBuilder = createMockSupabaseClient().from('transactions')

      // Mock the update query to capture what gets written
      let capturedNeedsReview: boolean | undefined
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        update: vi.fn((data: any) => {
          capturedNeedsReview = data.needs_review
          return {
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((onResolve) => {
              return Promise.resolve({ data: null, error: null }).then(onResolve)
            })
          }
        })
      } as any)

      // Test INV_PURCHASE_ transaction
      await (transactionService as any)._recomputeNeedsReview('test-account', 'project-1', 'INV_PURCHASE_project-1')

      expect(capturedNeedsReview).toBe(false)
    })
  })

  describe('notifyTransactionChanged', () => {
    it('applies delta adjustments for non-canonical transactions', async () => {
      const adjustSpy = vi
        .spyOn(transactionService, 'adjustSumItemPurchasePrices')
        .mockResolvedValue('0.00')
      const enqueueSpy = vi
        .spyOn(transactionService as any, '_enqueueRecomputeNeedsReview')
        .mockResolvedValue(undefined)

      await transactionService.notifyTransactionChanged('acct-1', 'CUSTOM_TX_123', { deltaSum: 42.5 })

      expect(adjustSpy).toHaveBeenCalledWith('acct-1', 'CUSTOM_TX_123', 42.5)
      expect(enqueueSpy).toHaveBeenCalledWith('acct-1', null, 'CUSTOM_TX_123')
    })

    it('skips delta adjustments for canonical transactions', async () => {
      const adjustSpy = vi
        .spyOn(transactionService, 'adjustSumItemPurchasePrices')
        .mockResolvedValue('0.00')
      const enqueueSpy = vi
        .spyOn(transactionService as any, '_enqueueRecomputeNeedsReview')
        .mockResolvedValue(undefined)

      await transactionService.notifyTransactionChanged('acct-1', 'INV_PURCHASE_project-123', { deltaSum: 10 })

      expect(adjustSpy).not.toHaveBeenCalled()
      expect(enqueueSpy).toHaveBeenCalledWith('acct-1', null, 'INV_PURCHASE_project-123')
    })
  })
})

describe('unifiedItemsService transaction amount immutability', () => {
  const accountId = 'test-account'
  const nonCanonicalId = 'CUSTOM_TX_123'
  const canonicalId = 'INV_PURCHASE_project-1'

  let updateItemSpy: ReturnType<typeof vi.spyOn>
  let auditSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    updateItemSpy = vi.spyOn(unifiedItemsService, 'updateItem').mockResolvedValue(undefined as any)
    auditSpy = vi.spyOn(auditService, 'logTransactionStateChange').mockResolvedValue()
  })

  afterEach(() => {
    updateItemSpy.mockRestore()
    auditSpy.mockRestore()
  })

  it('preserves manual amount when adding items to non-canonical transactions', async () => {
    const transactionRecord = {
      account_id: accountId,
      transaction_id: nonCanonicalId,
      item_ids: ['item-1'],
      amount: '500.00'
    }

    const selectBuilder = createMockQueryBuilder(transactionRecord)
    const updateBuilder = createMockQueryBuilder(null)
    let capturedUpdate: any = null
    updateBuilder.update = vi.fn((data: any) => {
      capturedUpdate = data
      return updateBuilder
    })

    vi.mocked(supabaseModule.supabase.from)
      .mockImplementationOnce(() => selectBuilder as any)
      .mockImplementationOnce(() => updateBuilder as any)

    await unifiedItemsService.addItemToTransaction(accountId, 'item-2', nonCanonicalId, '100.00', 'Purchase', 'manual')

    expect(capturedUpdate).toEqual({
      item_ids: ['item-1', 'item-2'],
      updated_at: expect.any(String)
    })
    expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ item_ids: ['item-1', 'item-2'] }))
    expect(vi.mocked(supabaseModule.supabase.from).mock.calls.map(call => call[0])).toEqual(['transactions', 'transactions'])
    expect(auditSpy).toHaveBeenCalledWith(accountId, nonCanonicalId, 'updated', expect.anything(), capturedUpdate)
  })

  it('recalculates canonical transaction amounts when adding items', async () => {
    const transactionRecord = {
      account_id: accountId,
      transaction_id: canonicalId,
      item_ids: ['item-1'],
      amount: '50.00',
      tax_rate_pct: null
    }

    const selectBuilder = createMockQueryBuilder(transactionRecord)
    const itemsBuilder = createMockQueryBuilder([
      { project_price: '50.00', market_value: null },
      { project_price: '25.00', market_value: null }
    ])
    const updateBuilder = createMockQueryBuilder(null)
    let capturedUpdate: any = null
    updateBuilder.update = vi.fn((data: any) => {
      capturedUpdate = data
      return updateBuilder
    })

    vi.mocked(supabaseModule.supabase.from)
      .mockImplementationOnce(() => selectBuilder as any)
      .mockImplementationOnce(() => itemsBuilder as any)
      .mockImplementationOnce(() => updateBuilder as any)

    await unifiedItemsService.addItemToTransaction(accountId, 'item-2', canonicalId, '25.00', 'Purchase', 'manual')

    expect(capturedUpdate).toEqual({
      item_ids: ['item-1', 'item-2'],
      updated_at: expect.any(String),
      amount: '75.00'
    })
    expect(vi.mocked(supabaseModule.supabase.from).mock.calls.map(call => call[0])).toEqual(['transactions', 'items', 'transactions'])
    expect(auditSpy).toHaveBeenCalledWith(accountId, canonicalId, 'updated', expect.anything(), capturedUpdate)
  })

  it('preserves manual amounts when removing items from non-canonical transactions', async () => {
    const transactionRecord = {
      account_id: accountId,
      transaction_id: nonCanonicalId,
      item_ids: ['item-1', 'item-2'],
      amount: '500.00'
    }

    const selectBuilder = createMockQueryBuilder(transactionRecord)
    const updateBuilder = createMockQueryBuilder(null)
    let capturedUpdate: any = null
    updateBuilder.update = vi.fn((data: any) => {
      capturedUpdate = data
      return updateBuilder
    })

    vi.mocked(supabaseModule.supabase.from)
      .mockImplementationOnce(() => selectBuilder as any)
      .mockImplementationOnce(() => updateBuilder as any)

    await unifiedItemsService.removeItemFromTransaction(accountId, 'item-2', nonCanonicalId, '0')

    expect(capturedUpdate).toEqual({
      item_ids: ['item-1'],
      updated_at: expect.any(String)
    })
    expect(vi.mocked(supabaseModule.supabase.from).mock.calls.map(call => call[0])).toEqual(['transactions', 'transactions'])
    expect(auditSpy).toHaveBeenCalledWith(accountId, nonCanonicalId, 'updated', transactionRecord, capturedUpdate)
  })
})
