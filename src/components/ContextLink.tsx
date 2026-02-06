import React from 'react'
import { Link, LinkProps, useLocation } from 'react-router-dom'
import { useNavigationStack } from '@/contexts/NavigationStackContext'

const isModifiedEvent = (e: React.MouseEvent) =>
  e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.button !== 0

export default function ContextLink(props: LinkProps) {
  const { onClick, ...rest } = props as any
  const location = useLocation()
  const navigationStack = useNavigationStack()

  const handleClick = (e: React.MouseEvent) => {
    // Respect browser conventions (ctrl/cmd-click, middle-click, etc.) so users can open links in a new tab.
    // In those cases we should not mutate the navigation stack.
    if (e.defaultPrevented || isModifiedEvent(e)) {
      if (typeof onClick === 'function') {
        onClick(e)
      }
      return
    }

    try {
      const scrollY = typeof window !== 'undefined' ? window.scrollY : undefined
      if (Number.isFinite(scrollY)) {
        navigationStack.push({ path: location.pathname + location.search, scrollY })
      } else {
        navigationStack.push(location.pathname + location.search)
      }
    } catch {
      // noop if stack not available
    }
    if (typeof onClick === 'function') {
      onClick(e)
    }
  }

  return <Link {...(rest as LinkProps)} onClick={handleClick} />
}


