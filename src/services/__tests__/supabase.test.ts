import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, createMockUser } from './test-utils'
import { UserRole } from '@/types'

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  const { createMockSupabaseClient } = await import('./test-utils')
  return {
    ...actual,
    createClient: vi.fn(() => createMockSupabaseClient())
  }
})

// Mock accountService
vi.mock('../accountService', () => ({
  accountService: {
    createAccount: vi.fn().mockResolvedValue('test-account-id'),
    addUserToAccount: vi.fn().mockResolvedValue(undefined)
  }
}))

// Import after mocks are set up
import {
  signInWithGoogle,
  signOutUser,
  getUserData,
  createUserInvitation,
  checkUserInvitation,
  acceptUserInvitation
} from '../supabase'
import * as supabaseModule from '../supabase'

describe('Supabase Auth Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('signInWithGoogle', () => {
    it('should initiate OAuth sign-in', async () => {
      vi.mocked(supabaseModule.supabase.auth.signInWithOAuth).mockResolvedValue({ data: {}, error: null })

      await expect(signInWithGoogle()).resolves.not.toThrow()
      expect(supabaseModule.supabase.auth.signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google'
        })
      )
    })

    it('should throw error on failure', async () => {
      const error = { message: 'OAuth error' }
      vi.mocked(supabaseModule.supabase.auth.signInWithOAuth).mockResolvedValue({ data: null, error })

      await expect(signInWithGoogle()).rejects.toEqual(error)
    })
  })

  describe('signOutUser', () => {
    it('should sign out user', async () => {
      vi.mocked(supabaseModule.supabase.auth.signOut).mockResolvedValue({ error: null })

      await expect(signOutUser()).resolves.not.toThrow()
      expect(supabaseModule.supabase.auth.signOut).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      const error = { message: 'Sign out error' }
      vi.mocked(supabaseModule.supabase.auth.signOut).mockResolvedValue({ error })

      await expect(signOutUser()).rejects.toEqual(error)
    })
  })

  describe('getUserData', () => {
    it('should return user data', async () => {
      const mockUser = { ...createMockUser(), account_id: 'test-account-id' }

      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...createMockSupabaseClient().from('users'),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockUser, error: null })
      } as any)

      const userData = await getUserData('test-user-id')
      expect(userData).toBeTruthy()
      expect(userData?.id).toBe('test-user-id')
      expect(userData?.email).toBe('test@example.com')
    })

    it('should return null when user not found', async () => {
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...createMockSupabaseClient().from('users'),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      } as any)

      const userData = await getUserData('non-existent-id')
      expect(userData).toBeNull()
    })
  })

  describe('createUserInvitation', () => {
    it('should create invitation', async () => {
      const mockQueryBuilder = createMockSupabaseClient().from('invitations')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'invitation-id' }, error: null })
      } as any)

      const invitationLink = await createUserInvitation(
        'test@example.com',
        UserRole.ADMIN,
        'inviter-id',
        'account-id'
      )
      expect(invitationLink).toContain('/invite/')
    })
  })

  describe('checkUserInvitation', () => {
    it('should return invitation when found', async () => {
      const mockInvitation = {
        id: 'invitation-id',
        email: 'test@example.com',
        role: 'admin',
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }
      const mockQueryBuilder = createMockSupabaseClient().from('invitations')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockInvitation, error: null })
      } as any)

      const invitation = await checkUserInvitation('test@example.com')
      expect(invitation).toBeTruthy()
      expect(invitation?.invitationId).toBe('invitation-id')
      expect(invitation?.role).toBe(UserRole.ADMIN)
    })

    it('should return null when invitation not found', async () => {
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...createMockSupabaseClient().from('invitations'),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      } as any)

      const invitation = await checkUserInvitation('test@example.com')
      expect(invitation).toBeNull()
    })
  })

  describe('acceptUserInvitation', () => {
    it('should accept invitation', async () => {
      const mockQueryBuilder = createMockSupabaseClient().from('invitations')
      
      vi.mocked(supabaseModule.supabase.from).mockReturnValue({
        ...mockQueryBuilder,
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      } as any)

      await expect(
        acceptUserInvitation('invitation-id')
      ).resolves.not.toThrow()
    })
  })
})
