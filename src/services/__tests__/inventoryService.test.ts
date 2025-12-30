import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, createMockProject, createNotFoundError } from './test-utils'

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
import { projectService, transactionService } from '../inventoryService'
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
})
