import React from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { NavigationStackProvider, useNavigationStack } from '@/contexts/NavigationStackContext'

function Consumer({ capture }: { capture: (nav: any) => void }) {
  const nav = useNavigationStack()
  React.useEffect(() => {
    capture(nav)
  }, [nav, capture])
  return null
}

describe('NavigationStackProvider', () => {
  beforeEach(() => {
    sessionStorage.removeItem('navStack:v1')
  })

  it('pushes, peeks, pops and reports size correctly', () => {
    let nav: any = null
    render(
      <NavigationStackProvider>
        <Consumer capture={(n) => (nav = n)} />
      </NavigationStackProvider>
    )

    act(() => {
      nav.push('/one')
      nav.push('/two')
    })

    expect(nav.size()).toBe(2)
    expect(nav.peek()?.path).toBe('/two')

    let popped: { path: string } | null
    act(() => {
      popped = nav.pop()
    })
    expect(popped?.path).toBe('/two')
    expect(nav.size()).toBe(1)

    act(() => {
      popped = nav.pop()
    })
    expect(popped?.path).toBe('/one')
    expect(nav.size()).toBe(0)
    expect(nav.pop()).toBeNull()
  })

  it('dedupes consecutive pushes', () => {
    let nav: any = null
    render(
      <NavigationStackProvider>
        <Consumer capture={(n) => (nav = n)} />
      </NavigationStackProvider>
    )

    act(() => {
      nav.push('/same')
      nav.push('/same')
    })

    expect(nav.size()).toBe(1)
  })

  it('hydrates from sessionStorage on mount', () => {
    sessionStorage.setItem('navStack:v1', JSON.stringify(['/a','/b']))
    let nav: any = null
    render(
      <NavigationStackProvider>
        <Consumer capture={(n) => (nav = n)} />
      </NavigationStackProvider>
    )

    // after mount the provider should have hydrated entries
    expect(nav.size()).toBe(2)
    expect(nav.pop()?.path).toBe('/b')
    expect(nav.pop()?.path).toBe('/a')
  })
})


