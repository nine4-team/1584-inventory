import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { User as AppUser, UserRole } from '../types'
import { accountService } from './accountService'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const missingEnvVars = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY'
].filter(Boolean)

if (missingEnvVars.length > 0) {
  throw new Error(`Missing Supabase environment variables: ${missingEnvVars.join(', ')}`)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'supabase.auth.token'
  }
})

// Dev-only: surface effective auth config (no secrets)
if (import.meta.env.DEV) {
  console.log('[SupabaseClient] Auth config', {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'supabase.auth.token'
  })
}

// Dev-only: fetch timing wrapper for auth endpoints to detect stalls
if (import.meta.env.DEV && typeof window !== 'undefined' && !(window as any).__AUTH_FETCH_LOGGER_INSTALLED__) {
  const originalFetch = window.fetch.bind(window)
  ;(window as any).__AUTH_FETCH_LOGGER_INSTALLED__ = true
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input as Request)?.method || 'GET').toUpperCase()
    let urlStr = ''
    try {
      urlStr = typeof input === 'string' ? input : (input as Request).url
    } catch {
      urlStr = ''
    }
    const start = Date.now()
    try {
      const response = await originalFetch(input as any, init)
      const elapsedMs = Date.now() - start
      // Only log Supabase auth endpoints
      if (urlStr.includes('/auth/v1/')) {
        let path = urlStr
        try {
          path = new URL(urlStr, window.location.origin).pathname + new URL(urlStr, window.location.origin).search
        } catch {
          // keep original
        }
        console.log('[AuthFetch]', { method, path, status: response.status, elapsedMs })
      }
      return response
    } catch (error) {
      const elapsedMs = Date.now() - start
      if (urlStr.includes('/auth/v1/')) {
        console.warn('[AuthFetch ERROR]', { method, url: urlStr, elapsedMs, error: (error as Error)?.message })
      }
      throw error
    }
  }
}

// Helper to check if Supabase is ready
export const isSupabaseReady = (): boolean => {
  return supabase !== null && typeof supabase === 'object'
}

// Initialize Supabase
export const initializeSupabase = async (): Promise<void> => {
  if (typeof window !== 'undefined') {
    // Supabase initializes automatically, but we can verify
    if (!isSupabaseReady()) {
      throw new Error('Supabase client is not properly initialized')
    }
    console.log('✅ Supabase initialized')
  }
}

// Initialize auth persistence (replaces initializeAuthPersistence)
export const initializeAuthPersistence = async (): Promise<void> => {
  if (typeof window !== 'undefined') {
    // Supabase handles persistence automatically via localStorage
    // Just verify session exists
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      console.log('✅ Auth session restored from localStorage')
    }
  }
}

// Get current user
export const getCurrentUser = async (): Promise<User | null> => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Get current session
export const getCurrentSession = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Check if authenticated
export const isAuthenticated = async (): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}

// Auth state change listener (replaces onAuthStateChanged)
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null)
  })
}

// Sign in with Google (replaces signInWithGoogle)
// Note: OAuth redirects immediately to Google, then back to /auth/callback
// The user will be available after the redirect completes in AuthCallback
export const signInWithGoogle = async (): Promise<void> => {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: 'select_account'
        }
      }
    })
    
    if (error) throw error
    
    // OAuth redirect happens immediately - user will be available after redirect
    // The AuthCallback component will handle user document creation
  } catch (error) {
    console.error('Google sign-in error:', error)
    throw error
  }
}

// Sign up with email and password
export const signUpWithEmailPassword = async (
  email: string,
  password: string
): Promise<void> => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    })
    
    if (error) throw error
    
    // If email confirmation is required, the user will need to verify their email
    // The invitation token is already stored in localStorage, so it will be processed
    // after email verification completes
    if (data.user && !data.session) {
      // Email confirmation required
      console.log('Email confirmation required. Check your email.')
    }
  } catch (error) {
    console.error('Email/password sign-up error:', error)
    throw error
  }
}

// Sign in with email and password
export const signInWithEmailPassword = async (
  email: string,
  password: string
): Promise<void> => {
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) throw error
    
    // Session is automatically set by Supabase, and the auth state change listener
    // in AuthContext will handle user document creation and state updates
  } catch (error) {
    console.error('Email/password sign-in error:', error)
    throw error
  }
}

// Sign out (replaces signOutUser)
export const signOutUser = async (): Promise<void> => {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  } catch (error) {
    console.error('Sign-out error:', error)
    throw error
  }
}

// Create or update user document in database (replaces createOrUpdateUserDocument)
export const createOrUpdateUserDocument = async (supabaseUser: User): Promise<void> => {
  try {
    const { data: userDoc, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', supabaseUser.id)
      .single()

    const userData: Partial<AppUser> = {
      id: supabaseUser.id,
      email: supabaseUser.email || '',
      fullName: supabaseUser.user_metadata?.full_name || 
                supabaseUser.user_metadata?.name ||
                supabaseUser.email?.split('@')[0] || 
                'User',
    }

    if (userDoc && !fetchError) {
      // Update existing user
      const { error: updateError } = await supabase
        .from('users')
        .update({
          full_name: userData.fullName,
          email: userData.email,
          last_login: new Date().toISOString()
        })
        .eq('id', supabaseUser.id)
      
      if (updateError) throw updateError
    } else {
      // New user: check if it's the first user
      const { data: existingUsers, error: countError } = await supabase
        .from('users')
        .select('id')
        .limit(1)

      if (countError) {
        console.error('Error checking existing users:', countError)
        throw countError
      }

      if (!existingUsers || existingUsers.length === 0) {
        // First user - grant owner permissions
        console.log('First user signing up. Granting owner permissions.')
        
        // Create user with owner role
        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert({
            id: supabaseUser.id,
            email: userData.email,
            full_name: userData.fullName,
            role: 'owner',
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString()
          })
          .select()
          .single()

        if (insertError) throw insertError

        if (newUser) {
          // Create default account
          const accountId = await accountService.createAccount('Default Account', supabaseUser.id)
          
          // Assign owner to their default account
          await accountService.assignUserToAccount(supabaseUser.id, accountId)
          console.log('First user setup complete.')
        }
      } else {
        // Subsequent new users
        let accountId: string | null = null
        let invitationId: string | null = null

        // Check for token-based invitation first (from localStorage)
        if (typeof window !== 'undefined') {
          const storedInvitationData = localStorage.getItem('pendingInvitationData')
          if (storedInvitationData) {
            try {
              const invData = JSON.parse(storedInvitationData)
              invitationId = invData.invitationId
              accountId = invData.accountId
              console.log(`Found token-based invitation: account ${accountId}, invitationId ${invitationId}`)
              // Clear the invitation data after consuming it
              localStorage.removeItem('pendingInvitationData')
            } catch (err) {
              console.error('Error parsing stored invitation data:', err)
              // Clear invalid data
              localStorage.removeItem('pendingInvitationData')
            }
          }
        }

        // Fallback to email-based invitation check if no token-based invitation found
        if (!invitationId && supabaseUser.email) {
          const invitation = await checkUserInvitation(supabaseUser.email)
          if (invitation) {
            invitationId = invitation.invitationId
            const { data: invitationData, error: invError } = await supabase
              .from('invitations')
              .select('account_id')
              .eq('id', invitation.invitationId)
              .single()

            if (invError) {
              console.error('Error fetching invitation:', invError)
            } else if (invitationData) {
              accountId = invitationData.account_id || null
            }
          }
        }

        // Create the user document
        // Determine role: first user in account gets 'admin', others get 'user'
        let userRole: 'admin' | 'user' = 'user'
        
        // Verify account exists before using it (prevent foreign key violation)
        if (accountId) {
          const { data: accountExists, error: accountCheckError } = await supabase
            .from('accounts')
            .select('id')
            .eq('id', accountId)
            .single()
          
          if (accountCheckError || !accountExists) {
            console.warn(`Account ${accountId} does not exist. Creating user without account_id.`, accountCheckError)
            accountId = null
          } else {
            // Check if this is the first user in this account
            const { data: existingAccountUsers } = await supabase
              .from('users')
              .select('id')
              .eq('account_id', accountId)
              .limit(1)
            
            if (!existingAccountUsers || existingAccountUsers.length === 0) {
              // First user in this account gets admin role
              userRole = 'admin'
            }
          }
        }

        const { error: insertError } = await supabase
          .from('users')
          .insert({
            id: supabaseUser.id,
            email: userData.email,
            full_name: userData.fullName,
            role: userRole,
            account_id: accountId || null,
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString()
          })

        if (insertError) throw insertError

        // If they were invited, accept the invitation
        if (invitationId && accountId) {
          // Only accept if not already accepted
          try {
            const { data: invCheck } = await supabase
              .from('invitations')
              .select('status')
              .eq('id', invitationId)
              .single()
            
            if (invCheck && invCheck.status === 'pending') {
              await acceptUserInvitation(invitationId)
            }
          } catch (err) {
            console.error('Error checking/accepting invitation:', err)
          }
        } else if (invitationId || accountId) {
          // Partial invitation data - log warning but don't fail
          console.warn('Incomplete invitation data:', { invitationId, accountId })
        }
      }
    }
  } catch (error) {
    console.error('Error creating/updating user document:', error)
    throw error
  }
}

// Get user data from database (replaces getUserData)
export const getUserData = async (uid: string): Promise<AppUser | null> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .single()

    if (error) {
      console.log('No user document found for UID:', uid)
      return null
    }

    // Get account_id from user.account_id
    const accountId = data?.account_id || null

    return {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role as 'owner' | 'admin' | 'user' | null,
      accountId: accountId || '',
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
      lastLogin: data.last_login ? new Date(data.last_login) : new Date()
    } as AppUser
  } catch (error) {
    console.error('Error fetching user data:', error)
    return null
  }
}

// Get current user with app user data (replaces getCurrentUserWithData)
export const getCurrentUserWithData = async (): Promise<{ 
  supabaseUser: User | null; 
  appUser: AppUser | null 
}> => {
  const { data: { user: supabaseUser } } = await supabase.auth.getUser()
  
  if (!supabaseUser) {
    console.log('No Supabase user found')
    return { supabaseUser: null, appUser: null }
  }

  console.log('Supabase user UID:', supabaseUser.id)
  console.log('Supabase user email:', supabaseUser.email)

  const appUser = await getUserData(supabaseUser.id)
  console.log('App user data:', appUser)

  return { supabaseUser, appUser }
}

// Generate a random token for invitations
const generateInvitationToken = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

// Invitation functions (Supabase-based)
export const createUserInvitation = async (
  email: string,
  role: UserRole,
  invitedBy: string,
  accountId?: string
): Promise<string> => {
  try {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days
    const token = generateInvitationToken()

    const { data, error } = await supabase
      .from('invitations')
      .insert({
        email,
        role: role === UserRole.ADMIN ? 'admin' : 'user',
        account_id: accountId || null,
        invited_by: invitedBy,
        status: 'pending',
        token,
        created_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      })
      .select('id')
      .single()

    if (error) throw error

    const invitationLink = `${window.location.origin}/invite/${token}`
    console.log('Invitation created for:', email, 'accountId:', accountId)
    return invitationLink
  } catch (error) {
    console.error('Error creating invitation:', error)
    throw error
  }
}

// Get invitation by token
export const getInvitationByToken = async (
  token: string
): Promise<{ 
  id: string; 
  email: string; 
  role: UserRole; 
  accountId: string | null;
  expiresAt: string;
} | null> => {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (error || !data) {
      return null
    }

    // Check if invitation is expired
    if (new Date(data.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', data.id)
      return null
    }

    return {
      id: data.id,
      email: data.email,
      role: data.role === 'admin' ? UserRole.ADMIN : UserRole.USER,
      accountId: data.account_id,
      expiresAt: data.expires_at
    }
  } catch (error) {
    console.error('Error getting invitation by token:', error)
    return null
  }
}

// Get pending invitations for an account
export const getPendingInvitations = async (
  accountId: string
): Promise<Array<{
  id: string;
  email: string;
  role: 'admin' | 'user';
  token: string;
  createdAt: string;
  expiresAt: string;
}>> => {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) throw error

    return (data || []).map(inv => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at
    }))
  } catch (error) {
    console.error('Error fetching pending invitations:', error)
    return []
  }
}

// Get all pending invitations for multiple accounts (for app owner)
export const getAllPendingInvitationsForAccounts = async (
  accountIds: string[]
): Promise<Record<string, Array<{
  id: string;
  email: string;
  role: 'admin' | 'user';
  token: string;
  createdAt: string;
  expiresAt: string;
}>>> => {
  try {
    if (accountIds.length === 0) return {}

    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .in('account_id', accountIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) throw error

    // Group invitations by account_id
    const grouped: Record<string, Array<{
      id: string;
      email: string;
      role: 'admin' | 'user';
      token: string;
      createdAt: string;
      expiresAt: string;
    }>> = {}

    ;(data || []).forEach(inv => {
      const accountId = inv.account_id
      if (!grouped[accountId]) {
        grouped[accountId] = []
      }
      grouped[accountId].push({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        token: inv.token,
        createdAt: inv.created_at,
        expiresAt: inv.expires_at
      })
    })

    return grouped
  } catch (error) {
    console.error('Error fetching all pending invitations:', error)
    return {}
  }
}

export const checkUserInvitation = async (
  email: string
): Promise<{ role: UserRole; invitationId: string } | null> => {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('email', email)
      .eq('status', 'pending')
      .single()

    if (error || !data) {
      return null
    }

    // Check if invitation is expired
    if (new Date(data.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', data.id)
      return null
    }

    return {
      role: data.role === 'admin' ? UserRole.ADMIN : UserRole.USER,
      invitationId: data.id
    }
  } catch (error) {
    console.error('Error checking invitation:', error)
    return null
  }
}

// Check invitation by token (for link-based flow)
// This allows checking both pending and accepted invitations
export const checkInvitationByToken = async (
  token: string
): Promise<{ role: UserRole; invitationId: string; email: string; accountId: string | null } | null> => {
  try {
    // First try to get pending invitation
    let invitation = await getInvitationByToken(token)
    
    // If not found as pending, check if it was already accepted
    if (!invitation) {
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'accepted')
        .single()

      if (!error && data) {
        invitation = {
          id: data.id,
          email: data.email,
          role: data.role === 'admin' ? UserRole.ADMIN : UserRole.USER,
          accountId: data.account_id,
          expiresAt: data.expires_at
        }
      }
    }

    if (!invitation) {
      return null
    }

    return {
      role: invitation.role,
      invitationId: invitation.id,
      email: invitation.email,
      accountId: invitation.accountId
    }
  } catch (error) {
    console.error('Error checking invitation by token:', error)
    return null
  }
}

export const acceptUserInvitation = async (invitationId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', invitationId)

    if (error) throw error

    console.log('Invitation accepted:', invitationId)
  } catch (error) {
    console.error('Error accepting invitation:', error)
    throw error
  }
}

