import { useEffect } from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
let mockChannels: unknown[] = []
let mockRealtimeState: 'connecting' | 'open' | 'closing' | 'closed' = 'closed'

vi.mock('@/services/supabase', () => ({
  supabase: {
    getChannels: () => mockChannels,
    realtime: {
      connectionState: () => mockRealtimeState,
    },
  },
}))

import { useRealtimeConnectionStatus } from '../useRealtimeConnectionStatus'

type HookState = ReturnType<typeof useRealtimeConnectionStatus>

function Harness({ interval = 10, onUpdate }: { interval?: number; onUpdate: (state: HookState) => void }) {
  const status = useRealtimeConnectionStatus(interval)
  useEffect(() => {
    onUpdate(status)
  }, [status, onUpdate])
  return null
}

describe('useRealtimeConnectionStatus', () => {
  beforeEach(() => {
    mockChannels = []
    mockRealtimeState = 'closed'
  })

  afterEach(() => {
    cleanup()
  })

  it('reports idle when no realtime channels are active', async () => {
    let latest: HookState | null = null
    render(<Harness onUpdate={state => (latest = state)} />)

    await waitFor(() => expect(latest).not.toBeNull())

    expect(latest).toMatchObject({
      hasActiveRealtimeChannels: false,
      realtimeStatus: 'idle',
      isRealtimeConnected: false,
    })
  })

  it('flags a disconnect when channels exist but the socket is closed', async () => {
    let latest: HookState | null = null
    render(<Harness onUpdate={state => (latest = state)} />)
    await waitFor(() => expect(latest).not.toBeNull())

    mockChannels = [{}]
    mockRealtimeState = 'closed'

    await waitFor(() => expect(latest?.hasActiveRealtimeChannels).toBe(true))
    expect(latest).toMatchObject({
      isRealtimeConnected: false,
      realtimeStatus: 'closed',
    })
  })
})
