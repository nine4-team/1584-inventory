import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RetrySyncButton } from '../RetrySyncButton'

const retrySyncMocks = vi.hoisted(() => ({
  triggerManualSync: vi.fn(),
  requestForegroundSync: vi.fn(),
  getSnapshot: vi.fn(),
  subscribe: vi.fn(),
  getSyncSchedulerSnapshot: vi.fn()
}))

vi.mock('@/services/operationQueue', () => ({
  operationQueue: {
    getSnapshot: retrySyncMocks.getSnapshot,
    subscribe: retrySyncMocks.subscribe
  }
}))

vi.mock('@/services/serviceWorker', () => ({
  triggerManualSync: retrySyncMocks.triggerManualSync
}))

vi.mock('@/services/syncScheduler', () => ({
  requestForegroundSync: retrySyncMocks.requestForegroundSync,
  getSyncSchedulerSnapshot: retrySyncMocks.getSyncSchedulerSnapshot
}))

describe('RetrySyncButton', () => {
  beforeEach(() => {
    retrySyncMocks.getSnapshot.mockReturnValue({
      accountId: null,
      length: 0,
      operations: [],
      lastEnqueueAt: null,
      lastOfflineEnqueueAt: null,
      lastEnqueueError: null,
      backgroundSyncAvailable: null,
      backgroundSyncReason: null
    })
    retrySyncMocks.subscribe.mockImplementation(() => () => {})
    retrySyncMocks.triggerManualSync.mockResolvedValue(undefined)
    retrySyncMocks.requestForegroundSync.mockResolvedValue(undefined)
    retrySyncMocks.getSyncSchedulerSnapshot.mockReturnValue({
      isRunning: false,
      pendingOperations: 0,
      retryAttempt: 0,
      nextRunAt: null,
      lastTrigger: null,
      lastError: null
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders pending count when queue has operations', () => {
    retrySyncMocks.getSnapshot.mockReturnValue({
      accountId: null,
      length: 3,
      operations: [],
      lastEnqueueAt: null,
      lastOfflineEnqueueAt: null,
      lastEnqueueError: null,
      backgroundSyncAvailable: null,
      backgroundSyncReason: null
    })
    render(<RetrySyncButton />)

    expect(screen.getByText('(3 pending)')).toBeInTheDocument()
  })

  it('shows warning when background sync is unavailable', () => {
    retrySyncMocks.getSnapshot.mockReturnValue({
      accountId: null,
      length: 0,
      operations: [],
      lastEnqueueAt: null,
      lastOfflineEnqueueAt: null,
      lastEnqueueError: null,
      backgroundSyncAvailable: false,
      backgroundSyncReason: 'no-controller'
    })
    render(<RetrySyncButton />)

    expect(
      screen.getByText(/Background sync failed — reload to activate the service worker/i)
    ).toBeInTheDocument()
  })

  it('triggers manual sync flows on click', async () => {
    render(<RetrySyncButton label="Force retry" />)

    const button = screen.getByRole('button', { name: /Force retry/i })
    fireEvent.click(button)

    await waitFor(() => expect(retrySyncMocks.triggerManualSync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(retrySyncMocks.requestForegroundSync).toHaveBeenCalledWith('manual'))
  })
})
