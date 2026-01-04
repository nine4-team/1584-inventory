import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, createNotFoundError } from './test-utils'

// Mock Supabase before importing services
vi.mock('../supabase', async () => {
  const { createMockSupabaseClient } = await import('./test-utils')
  return {
    supabase: createMockSupabaseClient()
  }
})

// Mock databaseService
vi.mock('../databaseService', () => ({
  convertTimestamps: vi.fn((data) => data)
}))

// Import after mocks are set up
import { businessProfileService } from '../businessProfileService'
import * as supabaseModule from '../supabase'

describe('businessProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBusinessProfile', () => {
    it('should return business profile when found in accounts table', async () => {
      const mockAccount = {
        id: 'test-account-id',
        name: 'Test Business', // name field now serves as both account name and business name
        business_logo_url: 'https://example.com/logo.png',
        business_profile_updated_at: new Date().toISOString(),
        business_profile_updated_by: 'user-id',
        business_profile_version: 1
      }
      const mockQueryBuilder = createMockSupabaseClient().from('accounts')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockAccount, error: null })
      } as any)

      const profile = await businessProfileService.getBusinessProfile('test-account-id')
      expect(profile).toBeTruthy()
      expect(profile?.accountId).toBe('test-account-id')
      expect(profile?.name).toBe('Test Business')
      expect(profile?.logoUrl).toBe('https://example.com/logo.png')
    })

    it('should return account name (business_name has been consolidated into name)', async () => {
      const mockAccount = {
        id: 'test-account-id',
        name: 'Account Name', // name field serves as both account name and business name
        business_logo_url: null,
        business_profile_updated_at: null,
        business_profile_updated_by: null,
        business_profile_version: 1
      }
      const mockQueryBuilder = createMockSupabaseClient().from('accounts')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockAccount, error: null })
      } as any)

      const profile = await businessProfileService.getBusinessProfile('test-account-id')
      expect(profile).toBeTruthy()
      expect(profile?.name).toBe('Account Name')
    })

    it('should return null when account not found', async () => {
      const notFoundError = createNotFoundError()
      const mockQueryBuilder = createMockSupabaseClient().from('accounts')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: notFoundError })
      } as any)

      const profile = await businessProfileService.getBusinessProfile('non-existent-id')
      expect(profile).toBeNull()
    })

    it('should handle errors gracefully', async () => {
      const error = { code: '500', message: 'Server error', details: null, hint: null }
      const mockQueryBuilder = createMockSupabaseClient().from('accounts')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error })
      } as any)

      const profile = await businessProfileService.getBusinessProfile('test-account-id')
      expect(profile).toBeNull()
    })
  })

  describe('updateBusinessProfile', () => {
    it('should update account business profile', async () => {
      const existingAccount = { 
        id: 'test-account-id',
        business_profile_version: 1
      }
      let updateCalled = false
      
      // Create an awaitable chain for the update operation
      const awaitableUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((onResolve?: (value: any) => any) => {
          updateCalled = true
          return Promise.resolve({ data: null, error: null }).then(onResolve)
        }),
        catch: vi.fn((onReject?: (error: any) => any) => {
          return Promise.resolve({ data: null, error: null }).catch(onReject)
        })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockImplementation((table) => {
        const mockQueryBuilder = createMockSupabaseClient().from(table)
        if (table === 'accounts') {
          return {
            ...mockQueryBuilder,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: existingAccount, error: null }),
            update: vi.fn().mockReturnValue(awaitableUpdateChain)
          } as any
        }
        return mockQueryBuilder as any
      })

      await businessProfileService.updateBusinessProfile(
        'test-account-id',
        'Updated Business',
        'https://example.com/new-logo.png',
        'user-id'
      )

      expect(updateCalled).toBe(true)
    })

    it('should handle null logo URL', async () => {
      const existingAccount = { 
        id: 'test-account-id',
        business_profile_version: 1
      }
      
      const awaitableUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((onResolve?: (value: any) => any) => {
          return Promise.resolve({ data: null, error: null }).then(onResolve)
        }),
        catch: vi.fn((onReject?: (error: any) => any) => {
          return Promise.resolve({ data: null, error: null }).catch(onReject)
        })
      }
      
      vi.mocked(supabaseModule.supabase.from).mockImplementation((table) => {
        const mockQueryBuilder = createMockSupabaseClient().from(table)
        if (table === 'accounts') {
          return {
            ...mockQueryBuilder,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: existingAccount, error: null }),
            update: vi.fn().mockReturnValue(awaitableUpdateChain)
          } as any
        }
        return mockQueryBuilder as any
      })

      await expect(
        businessProfileService.updateBusinessProfile(
          'test-account-id',
          'Test Business',
          null,
          'user-id'
        )
      ).resolves.not.toThrow()
    })

    it('should throw error on failure', async () => {
      const error = { code: '500', message: 'Server error', details: null, hint: null }
      
      vi.mocked(supabaseModule.supabase.from).mockImplementation((table) => {
        const mockQueryBuilder = createMockSupabaseClient().from(table)
        if (table === 'accounts') {
          return {
            ...mockQueryBuilder,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error })
          } as any
        }
        return mockQueryBuilder as any
      })

      await expect(
        businessProfileService.updateBusinessProfile(
          'test-account-id',
          'Test Business',
          'https://example.com/logo.png',
          'user-id'
        )
      ).rejects.toEqual(error)
    })
  })
})

