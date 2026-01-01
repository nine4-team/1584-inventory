import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RetrySyncButton } from '../RetrySyncButton'

const retrySyncMocks = vi.hoisted(() => ({
  triggerManualSync: vi.fn(),
  requestForegroundSync: vi.fn(),
  getQueueLength: vi.fn()
}))

vi.mock('@/services/operationQueue', () => ({
  operationQueue: {
    getQueueLength: retrySyncMocks.getQueueLength
  }
}))

vi.mock('@/services/serviceWorker', () => ({
  triggerManualSync: retrySyncMocks.triggerManualSync
}))

vi.mock('@/services/syncScheduler', () => ({
  requestForegroundSync: retrySyncMocks.requestForegroundSync
}))

describe('RetrySyncButton', () => {
  beforeEach(() => {
    retrySyncMocks.getQueueLength.mockReturnValue(0)
    retrySyncMocks.triggerManualSync.mockResolvedValue(undefined)
    retrySyncMocks.requestForegroundSync.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders pending count when queue has operations', () => {
    retrySyncMocks.getQueueLength.mockReturnValue(3)
    render(<RetrySyncButton />)

    expect(screen.getByText('(3 pending)')).toBeInTheDocument()
  })

  it('triggers manual sync flows on click', async () => {
    render(<RetrySyncButton label="Force retry" />)

    const button = screen.getByRole('button', { name: /Force retry/i })
    fireEvent.click(button)

    await waitFor(() => expect(retrySyncMocks.triggerManualSync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(retrySyncMocks.requestForegroundSync).toHaveBeenCalledWith('manual'))
  })
})
