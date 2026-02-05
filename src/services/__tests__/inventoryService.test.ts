import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, createMockProject, createNotFoundError, createMockQueryBuilder } from './test-utils'

// Mock Supabase before importing services
vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('./test-utils')
  return {
    supabase: createMockSupabaseClient(),
    getCurrentUser: vi.fn().mockResolvedValue({ id: 'test-user' })
  }
})

// Mock databaseService
vi.mock('../databaseService', () => ({
  ensureAuthenticatedForDatabase: vi.fn().mockResolvedValue(undefined),
  convertTimestamps: vi.fn((data) => data)
}))

// Mock budgetCategoriesService
vi.mock('../budgetCategoriesService', () => ({
  budgetCategoriesService: {
    getCategory: vi.fn()
  }
}))

// Mock lineageService
vi.mock('../lineageService', () => ({
  lineageService: {
    getEdgesFromTransaction: vi.fn()
  }
}))

// Mock accountPresetsService (used by canonical budget category helper)
vi.mock('../accountPresetsService', () => ({
  getDefaultCategory: vi.fn().mockResolvedValue(null)
}))

// Import after mocks are set up
import { projectService, transactionService, unifiedItemsService, auditService } from '../inventoryService'
import * as supabaseModule from '../supabase'
import { budgetCategoriesService } from '../budgetCategoriesService'
import { lineageService } from '../lineageService'

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

    it('queues offline create on failure', async () => {
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

      // createProject is offline-first: if the network write fails, it queues an offline operation
      // and returns the optimistic/offline project ID instead of throwing.
      const projectId = await projectService.createProject('test-account-id', projectData as any)
      expect(projectId).toMatch(/^P-/)
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

    it('forces needsReview=false when itemization is disabled', async () => {
      const mockQueryBuilder = createMockSupabaseClient().from('transactions')
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

      vi.spyOn(transactionService, 'getTransaction').mockResolvedValue({ categoryId: 'cat-1' } as any)
      vi.mocked(budgetCategoriesService.getCategory).mockResolvedValue({
        id: 'cat-1',
        accountId: 'test-account',
        name: 'Install',
        slug: 'install',
        isArchived: false,
        metadata: { itemizationEnabled: false },
        createdAt: new Date(),
        updatedAt: new Date()
      })
      const completenessSpy = vi
        .spyOn(transactionService, 'getTransactionCompleteness')
        .mockResolvedValue({ completenessStatus: 'incomplete' } as any)

      await (transactionService as any)._recomputeNeedsReview('test-account', 'project-1', 'TX-1')

      expect(capturedNeedsReview).toBe(false)
      expect(completenessSpy).not.toHaveBeenCalled()
    })
  })

  describe('updateTransaction', () => {
    it('prevents needsReview when itemization is disabled', async () => {
      const updateBuilder = createMockQueryBuilder(null)
      let capturedUpdate: any = null
      updateBuilder.update = vi.fn((data: any) => {
        capturedUpdate = data
        return updateBuilder
      })

      const categoryBuilder = createMockQueryBuilder({
        id: 'cat-1',
        account_id: 'acct-1'
      })

      vi.mocked(supabaseModule.supabase.from).mockImplementation((table: string) => {
        if (table === 'vw_budget_categories') {
          return categoryBuilder as any
        }
        if (table === 'transactions') {
          return updateBuilder as any
        }
        return createMockQueryBuilder() as any
      })

      vi.mocked(budgetCategoriesService.getCategory).mockResolvedValue({
        id: 'cat-1',
        accountId: 'acct-1',
        name: 'Install',
        slug: 'install',
        isArchived: false,
        metadata: { itemizationEnabled: false },
        createdAt: new Date(),
        updatedAt: new Date()
      })

      await transactionService.updateTransaction('acct-1', 'project-1', 'tx-1', {
        categoryId: 'cat-1',
        needsReview: true
      })

      expect(capturedUpdate.needs_review).toBe(false)
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

  describe('getTransactionCompleteness (canonical)', () => {
    it('excludes correction edges from moved-out item completeness', async () => {
      const txId = 'tx-1'
      const accountId = 'acct-1'
      const projectId = 'project-1'

      vi.spyOn(transactionService, 'getTransaction').mockResolvedValue({
        transactionId: txId,
        amount: '100.00',
        subtotal: '100.00',
        itemIds: ['item-a'],
        taxRatePct: null,
        taxRatePreset: null
      } as any)

      vi.spyOn(unifiedItemsService, 'getItemById').mockImplementation(async (_accountId, itemId) => {
        if (itemId === 'item-a') {
          return { itemId: 'item-a', purchasePrice: '50.00', transactionId: txId } as any
        }
        if (itemId === 'item-b') {
          return { itemId: 'item-b', purchasePrice: '50.00', transactionId: null } as any
        }
        return null
      })

      vi.spyOn(unifiedItemsService, 'getItemsForTransaction').mockResolvedValue([
        { itemId: 'item-a', purchasePrice: '50.00', transactionId: txId } as any
      ])

      vi.mocked(lineageService.getEdgesFromTransaction).mockResolvedValue([
        {
          id: 'edge-1',
          accountId,
          itemId: 'item-b',
          fromTransactionId: txId,
          toTransactionId: null,
          movementKind: 'correction',
          source: 'app',
          createdAt: new Date().toISOString()
        } as any
      ])

      const completeness = await transactionService.getTransactionCompleteness(accountId, projectId, txId)

      // Only item-a should be counted; item-b is linked via a correction edge and excluded.
      expect(completeness.itemsCount).toBe(1)
      expect(completeness.itemsNetTotal).toBe(50)
      expect(completeness.transactionSubtotal).toBe(100)
      expect(completeness.completenessStatus).toBe('incomplete')
    })

    it('is projectId-agnostic (projects vs business inventory parity)', async () => {
      const txId = 'tx-1'
      const accountId = 'acct-1'

      vi.spyOn(transactionService, 'getTransaction').mockResolvedValue({
        transactionId: txId,
        amount: '100.00',
        subtotal: '100.00',
        itemIds: [],
        taxRatePct: null,
        taxRatePreset: null
      } as any)

      vi.spyOn(unifiedItemsService, 'getItemsForTransaction').mockResolvedValue([
        { itemId: 'item-a', purchasePrice: '60.00', transactionId: txId } as any
      ])

      vi.spyOn(unifiedItemsService, 'getItemById').mockResolvedValue(null as any)

      vi.mocked(lineageService.getEdgesFromTransaction).mockResolvedValue([
        {
          id: 'edge-1',
          accountId,
          itemId: 'item-b',
          fromTransactionId: txId,
          toTransactionId: null,
          movementKind: 'sold',
          source: 'app',
          createdAt: new Date().toISOString()
        } as any
      ])

      // Provide item-b via getItemById (moved-out path)
      vi.spyOn(unifiedItemsService, 'getItemById').mockImplementation(async (_accountId, itemId) => {
        if (itemId === 'item-b') {
          return { itemId: 'item-b', purchasePrice: '40.00', transactionId: null } as any
        }
        return null
      })

      const asProject = await transactionService.getTransactionCompleteness(accountId, 'project-1', txId)
      const asBizInv = await transactionService.getTransactionCompleteness(accountId, '', txId)

      expect(asBizInv).toEqual(asProject)
      expect(asProject.itemsCount).toBe(2)
      expect(asProject.itemsNetTotal).toBe(100)
      expect(asProject.completenessStatus).toBe('complete')
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
