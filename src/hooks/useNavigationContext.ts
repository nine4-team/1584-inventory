import { useLocation } from 'react-router-dom'
import { useCallback, useMemo } from 'react'
import { useNavigationStack } from '../contexts/NavigationStackContext'
import { projectTransactionDetail } from '@/utils/routes'
import { getReturnToFromLocation } from '@/utils/navigationReturnTo'

export interface NavigationContext {
  getBackDestination: (defaultPath: string) => string
  getNavigationSource: () => string | null
  buildContextUrl: (targetPath: string, additionalParams?: Record<string, string>) => string
}

export function useNavigationContext(): NavigationContext {
  const location = useLocation()
  const navigationStack = useNavigationStack()
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])

  const getBackDestination = useCallback((defaultPath: string) => {
      // Prefer navigation stack first (mimic native Back).
      // Use `peek` here (non-mutating) because this function is called during render
      // to compute the Back link target; calling `pop` during render triggers state
      // updates and can cause render-time side-effects / freezes.
      try {
        const candidate = navigationStack.peek(location.pathname + location.search)
        if (candidate?.path) return candidate.path
      } catch {
        // ignore if stack not available
      }

      // Check for returnTo from state or query next
      const returnTo = getReturnToFromLocation(location)
      if (returnTo) return returnTo

      // Check for from parameter and handle accordingly
      const from = searchParams.get('from')
      switch (from) {
        case 'business-inventory-item':
          // If we're on a project page and came from business inventory item
          if (location.pathname.startsWith('/project/')) {
            return returnTo || '/business-inventory'
          }
          break
        case 'transaction':
          // If we're on an item page and came from transaction
          if (location.pathname.startsWith('/item/')) {
            const projectId = searchParams.get('project')
            const transactionId = searchParams.get('transactionId')
            if (projectId && transactionId) {
              return projectTransactionDetail(projectId, transactionId)
            }
          }
          break
      }

      return defaultPath
  }, [navigationStack, location.pathname, location.search, searchParams])

  const getNavigationSource = useCallback(() => {
    return searchParams.get('from')
  }, [searchParams])

  const buildContextUrl = useCallback((targetPath: string, additionalParams?: Record<string, string>) => {

      const url = new URL(targetPath, window.location.origin)
      const currentParams = new URLSearchParams(location.search)

      // Preserve navigation context
      const from = currentParams.get('from')
      if (from) url.searchParams.set('from', from)

      // Add current path as returnTo for back navigation (fallback)
      url.searchParams.set('returnTo', location.pathname + location.search)

      // Add any additional parameters
      if (additionalParams) {
        Object.entries(additionalParams).forEach(([key, value]) => {
          url.searchParams.set(key, value)
        })
      }

      return url.pathname + url.search
  }, [location.pathname, location.search])

  return useMemo(() => ({
    getBackDestination,
    getNavigationSource,
    buildContextUrl
  }), [getBackDestination, getNavigationSource, buildContextUrl])
}
