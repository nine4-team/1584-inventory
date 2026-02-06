import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useNavigationStack } from '@/contexts/NavigationStackContext'

interface ContextBackLinkProps {
  fallback: string
  className?: string
  children?: React.ReactNode
  title?: string
}

const isModifiedEvent = (e: React.MouseEvent) =>
  e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.button !== 0

export default function ContextBackLink({ fallback, className, children, title }: ContextBackLinkProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationStack = useNavigationStack()

  const handleClick = (e: React.MouseEvent) => {
    // Allow ctrl/cmd-click (open in new tab) and other modified clicks to behave like a normal link.
    if (e.defaultPrevented || isModifiedEvent(e)) return

    e.preventDefault()
    try {
      const entry = navigationStack.pop(location.pathname + location.search)
      const target = entry?.path || fallback
      if (Number.isFinite(entry?.scrollY)) {
        navigate(target, { state: { restoreScrollY: entry?.scrollY } })
      } else {
        navigate(target)
      }
    } catch {
      // fallback if stack not available
      navigate(fallback)
    }
  }

  return (
    // use an anchor so keyboard/assistive tech recognize it as a link
    <a href={fallback} onClick={handleClick} className={className} title={title}>
      {children}
    </a>
  )
}


