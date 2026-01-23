import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, createMockAccount, createNotFoundError } from './test-utils'

// Mock Supabase before importing services
vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('./test-utils')
  return {
    supabase: createMockSupabaseClient()
  }
})

// Mock databaseService
vi.mock('../databaseService', () => ({
  convertTimestamps: vi.fn((data) => data),
  handleSupabaseError: vi.fn((error, options) => {
    if (error && !options?.returnNullOnNotFound) {
      throw error
    }
    return error
  }),
  ensureAuthenticatedForDatabase: vi.fn().mockResolvedValue(undefined)
}))

// Mock networkStatusService
vi.mock('../networkStatusService', () => ({
  isNetworkOnline: vi.fn().mockReturnValue(true)
}))

// Mock accountPresetsService
vi.mock('../accountPresetsService', () => ({
  getBudgetCategoryOrder: vi.fn().mockResolvedValue([]),
  getDefaultCategory: vi.fn().mockResolvedValue(null),
  setDefaultCategory: vi.fn().mockResolvedValue(undefined)
}))

// Mock offlineMetadataService
vi.mock('../offlineMetadataService', () => ({
  cacheBudgetCategoriesOffline: vi.fn().mockResolvedValue(undefined),
  getCachedBudgetCategories: vi.fn().mockResolvedValue([])
}))

// Import after mocks are set up
import { budgetCategoriesService } from '../budgetCategoriesService'
import * as supabaseModule from '../supabase'

const createMockCategory = (overrides?: Partial<any>) => ({
  id: 'test-category-id',
  account_id: 'test-account-id',
  name: 'Test Category',
  slug: 'test-category',
  is_archived: false,
  metadata: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
})

// Helper to create RPC response format (JSONB object)
const createRpcCategoryResponse = (overrides?: Partial<any>) => ({
  id: 'test-category-id',
  account_id: 'test-account-id',
  name: 'Test Category',
  slug: 'test-category',
  is_archived: false,
  metadata: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
})

describe('budgetCategoriesService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure rpc is mocked
    if (!supabaseModule.supabase.rpc) {
      (supabaseModule.supabase as any).rpc = vi.fn()
    }
  })

  describe('getCategories', () => {
    it('should return categories for an account', async () => {
      const mockCategories = [
        createMockCategory({ id: 'cat-1', name: 'Category 1' }),
        createMockCategory({ id: 'cat-2', name: 'Category 2' })
      ]
      
      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockCategories, error: null })
      }
      
      // Make the chain awaitable
      queryChain.then = (onResolve?: (value: any) => any) => {
        return Promise.resolve({ data: mockCategories, error: null }).then(onResolve)
      }
      queryChain.catch = (onReject?: (error: any) => any) => {
        return Promise.resolve({ data: mockCategories, error: null }).catch(onReject)
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(queryChain as any)

      const categories = await budgetCategoriesService.getCategories('test-account-id')
      expect(categories).toHaveLength(2)
      expect(categories[0].name).toBe('Category 1')
      expect(categories[0].accountId).toBe('test-account-id')
    })

    it('should exclude archived categories by default', async () => {
      const mockCategories = [
        createMockCategory({ id: 'cat-1', name: 'Active Category', is_archived: false }),
        createMockCategory({ id: 'cat-2', name: 'Archived Category', is_archived: true })
      ]
      const filteredCategories = mockCategories.filter(c => !c.is_archived)
      
      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: filteredCategories, error: null })
      }
      
      // Make the chain awaitable
      queryChain.then = (onResolve?: (value: any) => any) => {
        return Promise.resolve({ data: filteredCategories, error: null }).then(onResolve)
      }
      queryChain.catch = (onReject?: (error: any) => any) => {
        return Promise.resolve({ data: filteredCategories, error: null }).catch(onReject)
      }

      vi.mocked(supabaseModule.supabase.from).mockReturnValue(queryChain as any)

      const categories = await budgetCategoriesService.getCategories('test-account-id', false)
      expect(categories).toHaveLength(1)
      expect(categories[0].name).toBe('Active Category')
      expect(categories[0].isArchived).toBe(false)
    })

    it('should include archived categories when requested', async () => {
      const mockCategories = [
        createMockCategory({ id: 'cat-1', name: 'Active Category', is_archived: false }),
        createMockCategory({ id: 'cat-2', name: 'Archived Category', is_archived: true })
      ]
      
      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockCategories, error: null })
      }
      
      // Make the chain awaitable
      queryChain.then = (onResolve?: (value: any) => any) => {
        return Promise.resolve({ data: mockCategories, error: null }).then(onResolve)
      }
      queryChain.catch = (onReject?: (error: any) => any) => {
        return Promise.resolve({ data: mockCategories, error: null }).catch(onReject)
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(queryChain as any)

      const categories = await budgetCategoriesService.getCategories('test-account-id', true)
      expect(categories).toHaveLength(2)
    })

    it('should enforce account_id scoping', async () => {
      let accountIdCalled = false
      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((field: string, value: any) => {
          if (field === 'account_id') {
            accountIdCalled = true
            expect(value).toBe('test-account-id')
          }
          return queryChain
        }),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(queryChain as any)

      await budgetCategoriesService.getCategories('test-account-id')
      expect(accountIdCalled).toBe(true)
    })
  })

  describe('getCategory', () => {
    it('should return a single category by ID', async () => {
      const mockCategory = createMockCategory()
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCategory, error: null })
      } as any)

      const category = await budgetCategoriesService.getCategory('test-account-id', 'test-category-id')
      expect(category).toBeTruthy()
      expect(category?.id).toBe('test-category-id')
      expect(category?.accountId).toBe('test-account-id')
    })

    it('should return null when category not found', async () => {
      const notFoundError = createNotFoundError()
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: notFoundError })
      } as any)

      const category = await budgetCategoriesService.getCategory('test-account-id', 'non-existent-id')
      expect(category).toBeNull()
    })

    it('should enforce account_id scoping', async () => {
      const mockCategory = createMockCategory()
      
      let accountIdCalled = false
      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((field: string, value: any) => {
          if (field === 'account_id') {
            accountIdCalled = true
            expect(value).toBe('test-account-id')
          }
          return queryChain
        }),
        single: vi.fn().mockResolvedValue({ data: mockCategory, error: null })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(queryChain as any)

      await budgetCategoriesService.getCategory('test-account-id', 'test-category-id')
      expect(accountIdCalled).toBe(true)
    })
  })

  describe('createCategory', () => {
    it('should create a new category via RPC', async () => {
      const mockRpcResponse = createRpcCategoryResponse({ name: 'New Category' })
      
      vi.mocked(supabaseModule.supabase.rpc).mockResolvedValue({
        data: mockRpcResponse,
        error: null
      } as any)

      const category = await budgetCategoriesService.createCategory(
        'test-account-id',
        'New Category'
      )
      expect(category).toBeTruthy()
      expect(category.name).toBe('New Category')
      expect(category.accountId).toBe('test-account-id')
      
      // Verify RPC was called with correct parameters
      expect(supabaseModule.supabase.rpc).toHaveBeenCalledWith('rpc_upsert_budget_category', {
        p_account_id: 'test-account-id',
        p_category_id: null,
        p_name: 'New Category',
        p_slug: null,
        p_metadata: null,
        p_is_archived: false
      })
    })

    it('should throw error if name is empty', async () => {
      await expect(
        budgetCategoriesService.createCategory('test-account-id', '')
      ).rejects.toThrow('Category name is required')
    })
  })

  describe('updateCategory', () => {
    it('should update a category via RPC', async () => {
      const existingCategory = createMockCategory({ name: 'Old Name' })
      const updatedRpcResponse = createRpcCategoryResponse({ name: 'New Name' })
      
      // Mock getCategory call (reads from view)
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingCategory, error: null })
      } as any)
      
      // Mock RPC call for update
      vi.mocked(supabaseModule.supabase.rpc).mockResolvedValue({
        data: updatedRpcResponse,
        error: null
      } as any)

      const category = await budgetCategoriesService.updateCategory('test-account-id', 'test-category-id', {
        name: 'New Name'
      })
      expect(category.name).toBe('New Name')
      
      // Verify RPC was called
      expect(supabaseModule.supabase.rpc).toHaveBeenCalledWith('rpc_upsert_budget_category', expect.objectContaining({
        p_account_id: 'test-account-id',
        p_category_id: 'test-category-id',
        p_name: 'New Name'
      }))
    })

    it('should throw error if category not found', async () => {
      const notFoundError = createNotFoundError()
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: notFoundError })
      } as any)

      await expect(
        budgetCategoriesService.updateCategory('test-account-id', 'non-existent-id', { name: 'New Name' })
      ).rejects.toThrow('Category not found or does not belong to this account')
    })

    it('should throw error if name is empty', async () => {
      const existingCategory = createMockCategory()
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingCategory, error: null })
      } as any)

      await expect(
        budgetCategoriesService.updateCategory('test-account-id', 'test-category-id', { name: '' })
      ).rejects.toThrow('Category name cannot be empty')
    })
  })

  describe('archiveCategory', () => {
    it('should archive a category via RPC', async () => {
      const existingCategory = createMockCategory({ is_archived: false })
      const archivedRpcResponse = createRpcCategoryResponse({ is_archived: true })
      
      // Mock getCategory call
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingCategory, error: null })
      } as any)
      
      // Mock RPC call for archive
      vi.mocked(supabaseModule.supabase.rpc).mockResolvedValue({
        data: archivedRpcResponse,
        error: null
      } as any)

      const category = await budgetCategoriesService.archiveCategory('test-account-id', 'test-category-id')
      expect(category.isArchived).toBe(true)
      
      // Verify RPC was called
      expect(supabaseModule.supabase.rpc).toHaveBeenCalledWith('rpc_archive_budget_category', {
        p_account_id: 'test-account-id',
        p_category_id: 'test-category-id',
        p_is_archived: true
      })
    })

    it('should throw error if category not found', async () => {
      const notFoundError = createNotFoundError()
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: notFoundError })
      } as any)

      await expect(
        budgetCategoriesService.archiveCategory('test-account-id', 'non-existent-id')
      ).rejects.toThrow('Category not found or does not belong to this account')
    })
  })

  describe('unarchiveCategory', () => {
    it('should unarchive a category via RPC', async () => {
      const archivedCategory = createMockCategory({ is_archived: true })
      const unarchivedRpcResponse = createRpcCategoryResponse({ is_archived: false })
      
      // Mock getCategory call
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: archivedCategory, error: null })
      } as any)
      
      // Mock RPC call for unarchive
      vi.mocked(supabaseModule.supabase.rpc).mockResolvedValue({
        data: unarchivedRpcResponse,
        error: null
      } as any)

      const category = await budgetCategoriesService.unarchiveCategory('test-account-id', 'test-category-id')
      expect(category.isArchived).toBe(false)
      
      // Verify RPC was called
      expect(supabaseModule.supabase.rpc).toHaveBeenCalledWith('rpc_archive_budget_category', {
        p_account_id: 'test-account-id',
        p_category_id: 'test-category-id',
        p_is_archived: false
      })
    })
  })

  describe('getTransactionCount', () => {
    it('should return transaction count for a category', async () => {
      let callCount = 0
      const queryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((field: string, value: any) => {
          callCount++
          // The second eq() call (category_id) should return the promise
          if (callCount === 2) {
            return Promise.resolve({ count: 5, error: null })
          }
          return queryChain
        })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue(queryChain as any)

      const count = await budgetCategoriesService.getTransactionCount('test-account-id', 'test-category-id')
      expect(count).toBe(5)
    })
  })

  describe('bulkArchiveCategories', () => {
    it('should archive multiple categories successfully', async () => {
      const category1 = createMockCategory({ id: 'cat-1', is_archived: false })
      const category2 = createMockCategory({ id: 'cat-2', is_archived: false })
      const archived1 = createRpcCategoryResponse({ id: 'cat-1', is_archived: true })
      const archived2 = createRpcCategoryResponse({ id: 'cat-2', is_archived: true })
      
      // Mock getCategory calls (reads from view)
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      vi.mocked(supabaseModule.supabase.from).mockImplementation((table) => {
        if (table === 'vw_budget_categories') {
          return {
            ...mockQueryBuilder,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn()
              .mockResolvedValueOnce({ data: category1, error: null })
              .mockResolvedValueOnce({ data: category2, error: null })
          } as any
        }
        return mockQueryBuilder as any
      })
      
      // Mock RPC calls for archive
      vi.mocked(supabaseModule.supabase.rpc)
        .mockResolvedValueOnce({ data: archived1, error: null } as any)
        .mockResolvedValueOnce({ data: archived2, error: null } as any)

      const result = await budgetCategoriesService.bulkArchiveCategories('test-account-id', ['cat-1', 'cat-2'])
      expect(result.successful).toHaveLength(2)
      expect(result.failed).toHaveLength(0)
    })

    it('should report failures for categories that cannot be archived', async () => {
      const category1 = createMockCategory({ id: 'cat-1' })
      const category2 = createMockCategory({ id: 'cat-2' })
      
      // Mock getCategory calls
      const mockQueryBuilder = createMockSupabaseClient().from('vw_budget_categories')
      vi.mocked(supabaseModule.supabase.from).mockImplementation((table) => {
        if (table === 'vw_budget_categories') {
          return {
            ...mockQueryBuilder,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn()
              .mockResolvedValueOnce({ data: category1, error: null })
              .mockResolvedValueOnce({ data: category2, error: null })
          } as any
        }
        return mockQueryBuilder as any
      })
      
      // Mock RPC calls - first fails, second succeeds
      vi.mocked(supabaseModule.supabase.rpc)
        .mockResolvedValueOnce({ data: null, error: { message: 'Archive failed' } } as any)
        .mockResolvedValueOnce({ data: createRpcCategoryResponse({ id: 'cat-2', is_archived: true }), error: null } as any)

      const result = await budgetCategoriesService.bulkArchiveCategories('test-account-id', ['cat-1', 'cat-2'])
      expect(result.successful).toContain('cat-2')
      expect(result.failed.length).toBeGreaterThan(0)
      expect(result.failed.some(f => f.categoryId === 'cat-1')).toBe(true)
    })
  })

  describe('ensureDefaultBudgetCategories', () => {
    it('sets itemization defaults on seeded categories', async () => {
      vi.spyOn(budgetCategoriesService, 'getCategories').mockResolvedValue([])
      const createSpy = vi
        .spyOn(budgetCategoriesService, 'createCategory')
        .mockResolvedValue({
          id: 'cat-id',
          accountId: 'test-account-id',
          name: 'Furnishings',
          slug: 'furnishings',
          isArchived: false,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date()
        } as any)

      await budgetCategoriesService.ensureDefaultBudgetCategories('test-account-id')

      const metadataCalls = createSpy.mock.calls.map((call) => call[2])
      expect(metadataCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemizationEnabled: true }),
          expect.objectContaining({ itemizationEnabled: false })
        ])
      )
      expect(createSpy).toHaveBeenCalledTimes(4)
    })
  })
})
