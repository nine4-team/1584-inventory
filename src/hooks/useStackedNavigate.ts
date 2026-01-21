import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation, To, NavigateOptions } from 'react-router-dom'
import { useNavigationStack } from '../contexts/NavigationStackContext'

// A small wrapper around react-router's navigate that records the current
// location on the navigation stack before navigating (so Back behaves natively).
export function useStackedNavigate() {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationStack = useNavigationStack()
  const locationRef = useRef(location)

  useEffect(() => {
    locationRef.current = location
  }, [location])

  const stackedNavigate = useCallback(
    (to: To, options?: NavigateOptions, meta?: { scrollY?: number }) => {
      try {
        // Don't record a navigation entry when performing a history jump (e.g. navigate(-1))
        // because that would push the current location onto the stack right before going back,
        // which causes the previous page to treat the back destination as the page we just left,
        // creating an endless back/forward loop.
        // Only push for non-numeric navigations or forward numeric jumps.
        const currentLocation = locationRef.current
        if (
          currentLocation &&
          (typeof to !== 'number' || to > 0)
        ) {
          const path = currentLocation.pathname + currentLocation.search
          if (Number.isFinite(meta?.scrollY)) {
            navigationStack.push({ path, scrollY: meta?.scrollY })
          } else {
            navigationStack.push(path)
          }
        }
      } catch {
        // ignore if stack not available
      }

      navigate(to, options)
    },
    [navigate, navigationStack]
  )

  return stackedNavigate
}


