import React, { createContext, useContext, useEffect, useMemo, useRef, useCallback } from 'react'

export interface NavigationStack {
  push: (entry: string) => void
  pop: (currentLocation?: string) => string | null
  peek: (currentLocation?: string) => string | null
  clear: () => void
  size: () => number
}

interface NavigationStackProviderProps {
  children: React.ReactNode
  mirrorToSessionStorage?: boolean
  maxLength?: number
}

const SESSION_KEY = 'navStack:v1'

const NavigationStackContext = createContext<NavigationStack | null>(null)

export function NavigationStackProvider({
  children,
  mirrorToSessionStorage = true,
  maxLength = 200,
}: NavigationStackProviderProps) {
  const stackRef = useRef<string[]>([])
  const debugEnabled = useMemo(
    () => typeof window !== 'undefined' && sessionStorage.getItem('navStack:debug') === '1',
    []
  )

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    if (!mirrorToSessionStorage) return
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          // keep only strings
          stackRef.current = parsed.filter((e) => typeof e === 'string')
        }
      }
      if (debugEnabled) {
        console.debug('NavigationStackProvider hydrated from sessionStorage:', stackRef.current)
      }
    } catch {
      // Ignore malformed data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback(() => {
    if (!mirrorToSessionStorage) return
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(stackRef.current))
      if (debugEnabled) {
        console.debug('NavigationStackProvider persisted stack to sessionStorage:', stackRef.current)
      }
    } catch {
      // ignore
    }
  }, [debugEnabled, mirrorToSessionStorage])

  const push = useCallback(
    (entry: string) => {
      if (!entry) return
      const top = stackRef.current[stackRef.current.length - 1]
      if (top === entry) return
      stackRef.current.push(entry)
      // trim to maxLength
      if (stackRef.current.length > maxLength) {
        stackRef.current = stackRef.current.slice(-maxLength)
      }
      persist()
      if (debugEnabled) {
        console.debug('NavigationStackProvider push:', entry, 'stack:', stackRef.current)
      }
    },
    [debugEnabled, maxLength, persist]
  )

  const pop = useCallback(
    (currentLocation?: string): string | null => {
      while (stackRef.current.length > 0) {
        const top = stackRef.current.pop() as string
        // skip entries equal to current location if provided
        if (currentLocation && top === currentLocation) {
          continue
        }
        persist()
        if (debugEnabled) {
          console.debug('NavigationStackProvider pop ->', top, 'stack:', stackRef.current)
        }
        return top
      }
      return null
    },
    [debugEnabled, persist]
  )

  const peek = useCallback((currentLocation?: string): string | null => {
    for (let i = stackRef.current.length - 1; i >= 0; i--) {
      const entry = stackRef.current[i]
      if (currentLocation && entry === currentLocation) {
        continue
      }
      return entry || null
    }
    return null
  }, [])

  const clear = useCallback(() => {
    stackRef.current = []
    persist()
  }, [persist])

  const size = useCallback(() => stackRef.current.length, [])

  const value = useMemo<NavigationStack>(
    () => ({
      push,
      pop,
      peek,
      clear,
      size,
    }),
    [push, pop, peek, clear, size]
  )

  return <NavigationStackContext.Provider value={value}>{children}</NavigationStackContext.Provider>
}

export function useNavigationStack(): NavigationStack {
  const ctx = useContext(NavigationStackContext)
  if (!ctx) {
    throw new Error('useNavigationStack must be used within a NavigationStackProvider')
  }
  return ctx
}


