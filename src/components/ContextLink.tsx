import React from 'react'
import { Link, LinkProps, useLocation } from 'react-router-dom'
import { useNavigationStack } from '@/contexts/NavigationStackContext'

export default function ContextLink(props: LinkProps) {
  const { onClick, ...rest } = props as any
  const location = useLocation()
  const navigationStack = useNavigationStack()

  const handleClick = (e: React.MouseEvent) => {
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


