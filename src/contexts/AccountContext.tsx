import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { accountService } from '../services/accountService'
import { Account } from '../types'
import { updateOfflineContext, initOfflineContext, getOfflineContext, subscribeToOfflineContext } from '../services/offlineContext'

interface AccountContextType {
  currentAccountId: string | null
  currentAccount: Account | null
  isOwner: boolean // System-level owner
  isAdmin: boolean // Account-level admin OR system owner
  loading: boolean
}

const defaultAccountContext: AccountContextType = {
  currentAccountId: null,
  currentAccount: null,
  isOwner: false,
  isAdmin: false,
  loading: true
}

const AccountContext = createContext<AccountContextType>(defaultAccountContext)

interface AccountProviderProps {
  children: ReactNode
}

export function AccountProvider({ children }: AccountProviderProps) {
  const { user, loading: authLoading, userLoading } = useAuth()
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null)
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [offlineFallbackAccountId, setOfflineFallbackAccountId] = useState<string | null>(null)

  // Check if user is system owner
  const isOwner = user?.role === 'owner' || false
  
  // Check if user is account admin (admin role OR system owner)
  const isAdmin = isOwner || user?.role === 'admin' || false

  useEffect(() => {
    let isMounted = true

    const hydrateOfflineContext = async () => {
      try {
        await initOfflineContext()
        if (!isMounted) return
        const cachedAccountId = getOfflineContext()?.accountId ?? null
        setOfflineFallbackAccountId(cachedAccountId)
        if (cachedAccountId) {
          setCurrentAccountId(prev => prev ?? cachedAccountId)
        }
      } catch (error) {
        console.warn('[AccountContext] Failed to hydrate offline context', error)
      }
    }

    hydrateOfflineContext()

    const unsubscribe = subscribeToOfflineContext(context => {
      if (!isMounted) return
      setOfflineFallbackAccountId(context?.accountId ?? null)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (
      !currentAccountId &&
      offlineFallbackAccountId &&
      !authLoading &&
      !userLoading &&
      user
    ) {
      setCurrentAccountId(offlineFallbackAccountId)
    }
  }, [authLoading, userLoading, user, currentAccountId, offlineFallbackAccountId])

  useEffect(() => {
    let isMounted = true

    const loadAccount = async () => {
      // Back off if auth is still loading or user is not ready
      if (authLoading || userLoading) {
        if (isMounted) {
          setLoading(true)
        }
        return
      }

      if (!user) {
        if (isMounted) {
          setCurrentAccountId(null)
          setCurrentAccount(null)
          setLoading(false)
        }
        return
      }

      const applyOfflineFallback = (): boolean => {
        if (!offlineFallbackAccountId) {
          return false
        }
        if (isMounted) {
          setCurrentAccountId(prev => prev ?? offlineFallbackAccountId)
          setCurrentAccount(prev => (prev?.id === offlineFallbackAccountId ? prev : null))
        }
        return true
      }

      // If we have a user and auth is ready, we start the loading process.
      if (isMounted) {
        setLoading(true)
      }

      // Safety timeout to ensure loading is set to false even if account loading fails
      const loadingTimeout = setTimeout(() => {
        if (isMounted) {
          console.warn('⚠️ Account loading timeout - setting loading to false')
          setLoading(false)
        }
      }, 10000) // 10 second timeout

      try {
        let finalAccount: Account | null = null

        // 1. Try getting account from user object's accountId
        if (user.accountId) {
          finalAccount = await accountService.getAccount(user.accountId)
        }

        // 2. If not found, try fetching from the users table (fallback)
        if (!finalAccount) {
          finalAccount = await accountService.getUserAccount(user.id)
        }

        // 3. If still not found and user is an owner, get the first account
        if (!finalAccount && isOwner) {
          const allAccounts = await accountService.getAllAccounts()
          if (allAccounts.length > 0) {
            finalAccount = allAccounts[0]
          }
        }
        
        // Now, update the state based on what was found.
        if (isMounted) {
          if (finalAccount) {
            setCurrentAccountId(finalAccount.id)
            setCurrentAccount(finalAccount)
          } else if (!applyOfflineFallback()) {
            setCurrentAccountId(null)
            setCurrentAccount(null)
          }
        }
      } catch (error) {
        console.error('Error loading account:', error)
        if (isMounted) {
          if (!applyOfflineFallback()) {
            setCurrentAccountId(null)
            setCurrentAccount(null)
          }
        }
      } finally {
        clearTimeout(loadingTimeout)
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadAccount()

    return () => {
      isMounted = false
    }
  }, [user, authLoading, userLoading, isOwner, offlineFallbackAccountId])

  useEffect(() => {
    updateOfflineContext({ accountId: currentAccountId }).catch(error => {
      console.warn('[AccountContext] Failed to persist offline account context', error)
    })
  }, [currentAccountId])

  const value: AccountContextType = useMemo(() => ({
    currentAccountId,
    currentAccount,
    isOwner,
    isAdmin,
    loading
  }), [currentAccountId, currentAccount, isOwner, isAdmin, loading])

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  )
}

let hasWarnedMissingProvider = false

export function useAccount() {
  const context = useContext(AccountContext)
  if (context === defaultAccountContext && !hasWarnedMissingProvider) {
    hasWarnedMissingProvider = true
    console.warn('useAccount was called outside of AccountProvider. Using fallback context.')
  }
  return context
}

