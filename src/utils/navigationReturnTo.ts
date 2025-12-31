import type { Location, NavigateFunction, NavigateOptions } from 'react-router-dom'

/**
 * Shape we store in location.state when carrying a manual returnTo target.
 */
type ReturnToState = {
  returnTo?: string | null
}

const getStateReturnTo = (state: unknown): string | null => {
  if (state && typeof state === 'object' && 'returnTo' in state) {
    const returnTo = (state as ReturnToState).returnTo
    return typeof returnTo === 'string' && returnTo.length > 0 ? returnTo : null
  }
  return null
}

/**
 * Derives the best available return destination for the current location.
 * Prefers location.state.returnTo, then `?returnTo=` query param.
 */
export const getReturnToFromLocation = (location: Location): string | null => {
  const fromState = getStateReturnTo(location.state)
  if (fromState) return fromState

  const searchParams = new URLSearchParams(location.search)
  const fromQuery = searchParams.get('returnTo')
  if (fromQuery && fromQuery.length > 0) {
    return fromQuery
  }
  return null
}

/**
 * Convenience helper for attaching the current path/search as a returnTo state object.
 */
export const buildReturnToState = (location: Location): ReturnToState => ({
  returnTo: location.pathname + location.search
})

/**
 * Navigates to returnTo (state/query) if present, otherwise falls back to the provided path.
 * Always performs a history replace so Back does not revisit the current page.
 */
export const navigateToReturnToOrFallback = (
  navigate: NavigateFunction,
  location: Location,
  fallbackPath: string,
  options?: NavigateOptions
) => {
  const target = getReturnToFromLocation(location) ?? fallbackPath
  navigate(target, {
    replace: true,
    ...options
  })
}

