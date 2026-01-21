import React, { createContext, useContext, useEffect, useMemo, useRef, useCallback } from 'react'

export interface NavigationStackEntry {
  path: string
  scrollY?: number
}

export interface NavigationStack {
  push: (entry: string | NavigationStackEntry) => void
  pop: (currentLocation?: string) => NavigationStackEntry | null
  peek: (currentLocation?: string) => NavigationStackEntry | null
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
  const stackRef = useRef<NavigationStackEntry[]>([])
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
          stackRef.current = parsed
            .map((entry) => {
              if (typeof entry === 'string') {
                return { path: entry }
              }
              if (entry && typeof entry === 'object' && typeof (entry as any).path === 'string') {
                const scrollY = (entry as any).scrollY
                return {
                  path: (entry as any).path,
                  scrollY: Number.isFinite(scrollY) ? scrollY : undefined,
                }
              }
              return null
            })
            .filter((entry): entry is NavigationStackEntry => Boolean(entry?.path))
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
    (entry: string | NavigationStackEntry) => {
      const normalized: NavigationStackEntry | null =
        typeof entry === 'string'
          ? { path: entry }
          : entry && typeof entry.path === 'string'
            ? { path: entry.path, scrollY: entry.scrollY }
            : null
      if (!normalized?.path) return

      const top = stackRef.current[stackRef.current.length - 1]
      if (top?.path === normalized.path) {
        if (Number.isFinite(normalized.scrollY)) {
          top.scrollY = normalized.scrollY
          persist()
        }
        return
      }

      stackRef.current.push(normalized)
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
    (currentLocation?: string): NavigationStackEntry | null => {
      while (stackRef.current.length > 0) {
        const top = stackRef.current.pop() as NavigationStackEntry
        // skip entries equal to current location if provided
        if (currentLocation && top.path === currentLocation) {
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

  const peek = useCallback((currentLocation?: string): NavigationStackEntry | null => {
    for (let i = stackRef.current.length - 1; i >= 0; i--) {
      const entry = stackRef.current[i]
      if (currentLocation && entry.path === currentLocation) {
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


