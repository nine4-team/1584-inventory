import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo, useRef } from 'react'
import { User as SupabaseUser } from '@supabase/supabase-js'
import {
  signInWithGoogle,
  signOutUser,
  getCurrentUserWithData,
  createOrUpdateUserDocument,
  supabase
} from '../services/supabase'
import { updateOfflineContext } from '../services/offlineContext'
import { User, UserRole } from '../types'

interface AuthContextType {
  supabaseUser: SupabaseUser | null
  user: User | null
  loading: boolean
  userLoading: boolean
  timedOutWithoutAuth: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  isAuthenticated: boolean
  hasRole: (role: UserRole) => boolean
  isOwner: () => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const authLogPrefix = '[AuthContext]'

function describeSupabaseUser(user: SupabaseUser | null) {
  if (!user) return 'null'
  const { id, email, last_sign_in_at: lastSignInAt } = user
  return JSON.stringify({ id, email, lastSignInAt })
}

function describeAppUser(user: User | null) {
  if (!user) return 'null'
  const { id, email, role } = user
  return JSON.stringify({ id, email, role })
}

// Helper to conditionally log debug/warn messages only in dev
function debugLog(message: string, data?: any) {
  if (import.meta.env.DEV) {
    // Use console.log so logs are visible by default in dev (Chrome hides console.debug unless Verbose is enabled)
    console.log(message, data)
  }
}

function warnLog(message: string, data?: any) {
  if (import.meta.env.DEV) {
    console.warn(message, data)
  } else {
    // In production, only log warnings without PII
    console.warn(message)
  }
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [userLoading, setUserLoading] = useState(false)
  const [timedOutWithoutAuth, setTimedOutWithoutAuth] = useState(false)
  
  // Ref to track if auth has been resolved (prevents timeout if already resolved)
  const hasResolvedAuthRef = useRef(false)
  // Ref to track if this is the initial load
  const isInitialLoadRef = useRef(true)
  // Unique instance ID for this effect (helps track double-invoke in StrictMode)
  const instanceIdRef = useRef(`auth-${Math.random().toString(36).slice(2, 9)}`)
  // Listener ID counter
  const listenerIdRef = useRef(0)
  // Track when init started for timing metrics
  const initStartTimeRef = useRef(0)
  const supabaseUserLogRef = useRef<SupabaseUser | null>(null)
  const userLogRef = useRef<User | null>(null)

  useEffect(() => {
    supabaseUserLogRef.current = supabaseUser
  }, [supabaseUser])

  useEffect(() => {
    userLogRef.current = user
  }, [user])

  useEffect(() => {
    if (timedOutWithoutAuth && (supabaseUser || user)) {
      setTimedOutWithoutAuth(false)
    }
  }, [supabaseUser, user, timedOutWithoutAuth])

  useEffect(() => {
    const userId = supabaseUser?.id ?? null
    updateOfflineContext({ userId }).catch(error => {
      console.warn('[AuthContext] Failed to persist offline user context', error)
    })
  }, [supabaseUser])

  useEffect(() => {
    const instanceId = instanceIdRef.current
    const initStartTime = Date.now()
    initStartTimeRef.current = initStartTime

    let isMounted = true
    let authStateUnsubscribe: { data: { subscription: any } } | null = null
    let loadingTimeout: NodeJS.Timeout | null = null
    let getSessionStartTime = 0

    if (import.meta.env.DEV) {
      debugLog(`${authLogPrefix} [EFFECT MOUNT] instanceId=${instanceId}, strictMode might cause double-invoke`)
    }

    // Environment preflight (dev only) - helps diagnose stalls before subscription/getSession
    if (import.meta.env.DEV) {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : undefined
      const swController = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined
      const hasServiceWorker = !!swController
      const swUrl = hasServiceWorker ? (swController as ServiceWorker).scriptURL : null
      const urlSource = typeof window !== 'undefined' ? (window.location.hash || window.location.search || '') : ''
      const urlHasAuthParams = /access_token|refresh_token/i.test(urlSource)
      let localStorageTokenExists = false
      try {
        localStorageTokenExists = typeof window !== 'undefined' && !!window.localStorage.getItem('supabase.auth.token')
      } catch {
        // ignore storage access errors
      }
      debugLog(`${authLogPrefix} [BOOT PREFLIGHT]`, {
        instanceId,
        online,
        hasServiceWorker,
        swUrl,
        urlHasAuthParams,
        localStorageTokenExists
      })
    }

    // Single place to resolve loading state
    const resolveLoading = (source: string) => {
      if (isMounted && !hasResolvedAuthRef.current) {
        hasResolvedAuthRef.current = true
        if (loadingTimeout) clearTimeout(loadingTimeout)
        const elapsedMs = Date.now() - initStartTime
        setLoading(false)
        debugLog(`${authLogPrefix} [LOADING RESOLVED] source=${source} elapsedMs=${elapsedMs} instanceId=${instanceId} supabaseUser=${describeSupabaseUser(supabaseUserLogRef.current)} appUser=${describeAppUser(userLogRef.current)}`)
      }
    }

    // Safety timeout to prevent infinite loading state
    loadingTimeout = setTimeout(() => {
      if (isMounted && !hasResolvedAuthRef.current) {
        const elapsedMs = Date.now() - initStartTime
        const nowTs = Date.now()
        const getSessionElapsedMsSnapshot = getSessionStartTime ? nowTs - getSessionStartTime : null
        const online = typeof navigator !== 'undefined' ? navigator.onLine : undefined
        const swController = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined
        const hasServiceWorker = !!swController
        const swUrl = hasServiceWorker ? (swController as ServiceWorker).scriptURL : null
        let localStorageTokenExists = false
        try {
          localStorageTokenExists = typeof window !== 'undefined' && !!window.localStorage.getItem('supabase.auth.token')
        } catch {
          // ignore
        }
        // Use refs to check actual current state (avoid stale closures)
        const currentSupabaseUser = supabaseUserLogRef.current
        const currentAppUser = userLogRef.current
        warnLog(`${authLogPrefix} [TIMEOUT] Initialization timed out after ${elapsedMs}ms. Forcing loading to false.`, {
          instanceId,
          supabaseUser: describeSupabaseUser(currentSupabaseUser),
          appUser: describeAppUser(currentAppUser),
          hasResolvedAuthRef: hasResolvedAuthRef.current,
          getSessionStarted: !!getSessionStartTime,
          getSessionElapsedMs: getSessionElapsedMsSnapshot,
          online,
          hasServiceWorker,
          swUrl,
          localStorageTokenExists
        })
        resolveLoading('safety_timeout')
        
        // If timeout fires and we still have no auth, flag it for redirect
        // Use refs to avoid stale closure
        if (!currentSupabaseUser && !currentAppUser) {
          setTimedOutWithoutAuth(true)
        }
      }
    }, 7000) // 7-second timeout

    debugLog(`${authLogPrefix} [INIT START] instanceId=${instanceId} timestamp=${new Date().toISOString()}`)

    // FIRST: Subscribe to auth state changes (before getSession to avoid missing fast SIGNED_IN events)
    const listenerId = ++listenerIdRef.current
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return

      const authUser = session?.user || null
      debugLog(`${authLogPrefix} [LISTENER ${listenerId}] onAuthStateChange event`, {
        instanceId,
        event,
        hasSession: !!session,
        isInitialLoad: isInitialLoadRef.current,
      })
      
      setSupabaseUser(authUser)
      supabaseUserLogRef.current = authUser

      // During initial load, this listener's ONLY job is to set the supabaseUser.
      // The initializeAuth function will handle fetching the app user data AFTER getSession completes.
      if (isInitialLoadRef.current) {
        if (!authUser) {
          // If there's no user, we can resolve loading early.
          resolveLoading(`listener_${listenerId}_${event}_no_user`)
        }
        return
      }

      // The logic below only runs for auth events AFTER the initial load.
      if (authUser) {
        const currentUser = userLogRef.current;
        // If we already have a matching app user, we don't need to do anything.
        // This prevents re-fetching data on events like TOKEN_REFRESHED or the spurious SIGNED_IN that follows.
        if (currentUser && currentUser.id === authUser.id) {
          debugLog(`${authLogPrefix} [LISTENER ${listenerId}] Skipping data fetch for event '${event}' as user is already loaded.`);
          return;
        }

        setTimedOutWithoutAuth(false)
        if (event === 'SIGNED_IN') {
          setUserLoading(true)
          try {
            // This is a fresh, user-initiated SIGNED_IN event.
            const createUserDocStartTime = Date.now()
            debugLog(`${authLogPrefix} [LISTENER ${listenerId}] Handling fresh SIGNED_IN event. Ensuring user document is up to date`, {
              supabaseUser: describeSupabaseUser(authUser)
            })
            await createOrUpdateUserDocument(authUser)
            const createUserDocElapsedMs = Date.now() - createUserDocStartTime
            debugLog(`${authLogPrefix} [LISTENER ${listenerId}] createOrUpdateUserDocument completed in ${createUserDocElapsedMs}ms`)
            
            const { appUser } = await getCurrentUserWithData()
            if (isMounted) {
              setUser(appUser)
              userLogRef.current = appUser
              debugLog(`${authLogPrefix} [LISTENER ${listenerId}] Updated app user after fresh sign-in`, { appUser: describeAppUser(appUser) })
            }
          } catch (error) {
            console.error(`${authLogPrefix} [LISTENER ${listenerId}] Error handling a fresh SIGNED_IN event`, error)
            if (isMounted) setUser(null)
          } finally {
            if (isMounted) setUserLoading(false)
          }
        }
      } else {
        // User is signed out post-initial load
        if (isMounted) {
          setUser(null)
          userLogRef.current = null
          setUserLoading(false)
        }
      }
    })

    authStateUnsubscribe = { data: { subscription } }
    debugLog(`${authLogPrefix} [SUBSCRIPTION] Created listener ${listenerId} for instanceId=${instanceId}`)

    // THEN: Check for existing session (after subscription is set up)
    const initializeAuth = async () => {
      try {
        getSessionStartTime = Date.now()
        debugLog(`${authLogPrefix} [GET_SESSION] Starting getSession() call for instanceId=${instanceId}`)
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        const getSessionElapsedMs = Date.now() - getSessionStartTime
        
        if (sessionError) {
          console.error(`${authLogPrefix} [GET_SESSION] Error retrieving initial session after ${getSessionElapsedMs}ms`, sessionError)
        }
        
        debugLog(`${authLogPrefix} [GET_SESSION] Initial session response after ${getSessionElapsedMs}ms`, { hasSession: !!session })
        
        // After getSession completes, the client is initialized. Now we can fetch app data.
        if (isMounted && session) {
          setUserLoading(true)
          try {
            const { appUser } = await getCurrentUserWithData()
            if (isMounted) {
              setUser(appUser)
              userLogRef.current = appUser
              debugLog(`${authLogPrefix} [INIT] Loaded initial app user`, { appUser: describeAppUser(appUser) })
            }
          } catch (error) {
            console.error(`${authLogPrefix} [INIT] Error loading initial user data`, error)
            if (isMounted) setUser(null)
          } finally {
            if (isMounted) setUserLoading(false)
          }
        }
        
        // Always resolve loading after the entire initial auth flow is complete.
        resolveLoading('initialization_complete')
      } catch (error) {
        console.error(`${authLogPrefix} [INIT_ERROR] Error during auth initialization`, error)
        resolveLoading('init_error')
      } finally {
        isInitialLoadRef.current = false
      }
    }

    initializeAuth()

    return () => {
      isMounted = false
      if (loadingTimeout) clearTimeout(loadingTimeout)
      if (authStateUnsubscribe?.data?.subscription) {
        authStateUnsubscribe.data.subscription.unsubscribe()
        debugLog(`${authLogPrefix} [EFFECT CLEANUP] Unsubscribed from auth listener instanceId=${instanceId}`)
      }
      if (import.meta.env.DEV) {
        const cleanupElapsedMs = Date.now() - initStartTime
        debugLog(`${authLogPrefix} [EFFECT CLEANUP] Cleanup after ${cleanupElapsedMs}ms hasResolvedAuthRef=${hasResolvedAuthRef.current} instanceId=${instanceId}`)
      }
    }
  }, [])

  const signIn = useCallback(async () => {
    try {
      debugLog(`${authLogPrefix} signIn invoked`)
      // Don't set global loading - let the auth listener handle state changes
      // Local UI components should show their own loading states during OAuth redirect
      await signInWithGoogle()

      // Note: OAuth redirect happens immediately - user will be available after redirect
      // The auth listener will handle user document creation and state updates
    } catch (error) {
      console.error(`${authLogPrefix} Sign in error`, error)
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      debugLog(`${authLogPrefix} signOut invoked`)
      // Don't set global loading - let the auth listener handle state changes
      await signOutUser()
    } catch (error) {
      console.error(`${authLogPrefix} Sign out error`, error)
      throw error
    }
  }, [])

  const hasRole = useCallback((role: UserRole): boolean => {
    // Removed excessive logging - only log in development if needed for debugging
    return user?.role === role || user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN
  }, [user?.role])

  const isOwner = useCallback((): boolean => {
    return user?.role === 'owner' || false
  }, [user?.role])

  const value: AuthContextType = useMemo(() => ({
    supabaseUser,
    user,
    loading,
    userLoading,
    timedOutWithoutAuth,
    signIn,
    signOut,
    isAuthenticated: !!supabaseUser,
    hasRole,
    isOwner
  }), [supabaseUser, user, loading, userLoading, timedOutWithoutAuth, hasRole, isOwner, signIn, signOut])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
