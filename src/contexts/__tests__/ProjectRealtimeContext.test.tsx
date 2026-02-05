import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, beforeEach, afterEach, vi, it, expect } from 'vitest'
import { ProjectRealtimeProvider, useProjectRealtime } from '../ProjectRealtimeContext'

const mockGetProject = vi.fn()
const mockGetTransactions = vi.fn()
const mockGetItems = vi.fn()
const mockSubscribeTransactions = vi.fn()
const mockSubscribeItems = vi.fn()
const mockSubscribeLineage = vi.fn()

vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({ currentAccountId: 'account-1' })
}))

vi.mock('@/services/inventoryService', () => ({
  projectService: {
    getProject: (...args: any[]) => mockGetProject(...args)
  },
  transactionService: {
    getTransactions: (...args: any[]) => mockGetTransactions(...args),
    subscribeToTransactions: (...args: any[]) => mockSubscribeTransactions(...args)
  },
  unifiedItemsService: {
    getItemsByProject: (...args: any[]) => mockGetItems(...args),
    subscribeToProjectItems: (...args: any[]) => mockSubscribeItems(...args),
    syncProjectItemsRealtimeCache: vi.fn()
  }
}))

vi.mock('@/services/lineageService', () => ({
  lineageService: {
    subscribeToEdgesFromTransaction: (...args: any[]) => mockSubscribeLineage(...args)
  }
}))

vi.mock('@/services/spaceService', () => ({
  spaceService: {
    listSpaces: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('@/utils/queryClient', () => ({
  getGlobalQueryClient: vi.fn(() => null)
}))

vi.mock('@/services/networkStatusService', () => ({
  isNetworkOnline: vi.fn(() => true),
  getNetworkStatusSnapshot: vi.fn(() => ({ isOnline: true })),
  subscribeToNetworkStatus: vi.fn(() => () => {})
}))

vi.mock('@/services/serviceWorker', () => ({
  onSyncEvent: vi.fn(() => () => {})
}))

const baseProject = {
  id: 'project-1',
  name: 'Demo Project',
  description: '',
  clientName: '',
  budget: undefined,
  designFee: undefined,
  budgetCategories: undefined,
  mainImageUrl: undefined,
  accountId: 'account-1',
  createdAt: '',
  updatedAt: '',
  createdBy: '',
  metadata: {},
  itemCount: 0,
  transactionCount: 0,
  totalValue: 0
}

const baseTransaction = {
  transactionId: 'tx-1',
  amount: '10.00',
  transactionDate: '2023-01-01',
  status: 'completed',
  source: 'manual'
} as any

const baseItem = {
  itemId: 'item-1',
  description: 'Lamp',
  projectId: 'project-1'
} as any

const TestConsumer = ({ projectId }: { projectId: string }) => {
  const { transactions, refreshCollections } = useProjectRealtime(projectId)
  return (
    <div>
      <span data-testid="transaction-count">{transactions.length}</span>
      <button data-testid="refresh-button" onClick={() => refreshCollections({ includeProject: true })}>
        refresh
      </button>
    </div>
  )
}

const TelemetryConsumer = ({ projectId }: { projectId: string }) => {
  const { telemetry } = useProjectRealtime(projectId)
  return (
    <div>
      <span data-testid="last-collections">{telemetry.lastCollectionsRefreshAt ?? ''}</span>
      <span data-testid="last-transactions">{telemetry.lastTransactionsRefreshAt ?? ''}</span>
    </div>
  )
}

describe('ProjectRealtimeProvider', () => {
  let transactionCallback: ((txs: any[]) => void) | null = null
  let transactionUnsubscribe: ReturnType<typeof vi.fn>
  let itemsUnsubscribe: ReturnType<typeof vi.fn>

  beforeEach(() => {
    transactionCallback = null
    transactionUnsubscribe = vi.fn()
    itemsUnsubscribe = vi.fn()
    mockGetProject.mockResolvedValue(baseProject)
    mockGetTransactions.mockResolvedValue([baseTransaction])
    mockGetItems.mockResolvedValue([baseItem])
    mockSubscribeTransactions.mockImplementation((_accountId, _projectId, callback, _initial, options) => {
      transactionCallback = callback
      options?.onStatusChange?.('SUBSCRIBED')
      return transactionUnsubscribe
    })
    mockSubscribeItems.mockImplementation((_accountId, _projectId, callback, _initial, options) => {
      callback([baseItem])
      options?.onStatusChange?.('SUBSCRIBED')
      return itemsUnsubscribe
    })
    mockSubscribeLineage.mockReturnValue(vi.fn())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('updates consumers when realtime transaction payload arrives', async () => {
    render(
      <ProjectRealtimeProvider>
        <TestConsumer projectId="project-1" />
      </ProjectRealtimeProvider>
    )

    expect(await screen.findByTestId('transaction-count')).toHaveTextContent('1')

    const newTransaction = { ...baseTransaction, transactionId: 'tx-2' }
    act(() => {
      transactionCallback?.([baseTransaction, newTransaction])
    })

    await waitFor(() => {
      expect(screen.getByTestId('transaction-count')).toHaveTextContent('2')
    })
  })

  it('updates telemetry timestamps when realtime payloads arrive', async () => {
    let currentTime = new Date('2025-01-01T00:00:00Z').getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

    try {
      render(
        <ProjectRealtimeProvider>
          <TelemetryConsumer projectId="project-1" />
        </ProjectRealtimeProvider>
      )

      const initial = Number((await screen.findByTestId('last-collections')).textContent)
      expect(initial).toBeGreaterThan(0)

      currentTime = new Date('2025-01-01T00:05:00Z').getTime()
      const newTransaction = { ...baseTransaction, transactionId: 'tx-2' }
      act(() => {
        transactionCallback?.([baseTransaction, newTransaction])
      })

      await waitFor(() => {
        const updated = Number(screen.getByTestId('last-collections').textContent)
        expect(updated).toBeGreaterThan(initial)
        expect(Number(screen.getByTestId('last-transactions').textContent)).toBe(updated)
      })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('refreshes collections when fallback refresh is invoked', async () => {
    render(
      <ProjectRealtimeProvider>
        <TestConsumer projectId="project-1" />
      </ProjectRealtimeProvider>
    )

    expect(await screen.findByTestId('transaction-count')).toHaveTextContent('1')

    fireEvent.click(screen.getByTestId('refresh-button'))

    await waitFor(() => {
      expect(mockGetTransactions).toHaveBeenCalledTimes(2)
      expect(mockGetItems).toHaveBeenCalledTimes(2)
      expect(mockGetProject).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps subscriptions active until all consumers release the project', async () => {
    const { getByTestId } = render(<MultiConsumerHarness />)

    expect(await screen.findAllByTestId('transaction-count')).toHaveLength(1)
    expect(mockSubscribeTransactions).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTestId('toggle-second'))
    await waitFor(() => {
      expect(screen.getAllByTestId('transaction-count')).toHaveLength(2)
    })
    expect(mockGetProject).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTestId('toggle-second'))
    await waitFor(() => {
      expect(screen.getAllByTestId('transaction-count')).toHaveLength(1)
    })
    expect(transactionUnsubscribe).not.toHaveBeenCalled()

    fireEvent.click(getByTestId('toggle-first'))
    await waitFor(() => {
      expect(transactionUnsubscribe).toHaveBeenCalledTimes(1)
    })
  })
})

const MultiConsumerHarness = () => {
  const [showFirst, setShowFirst] = useState(true)
  const [showSecond, setShowSecond] = useState(false)
  return (
    <ProjectRealtimeProvider cleanupDelayMs={0}>
      {showFirst && <TestConsumer projectId="project-1" />}
      {showSecond && <TestConsumer projectId="project-1" />}
      <button data-testid="toggle-first" onClick={() => setShowFirst(prev => !prev)}>
        toggle-first
      </button>
      <button data-testid="toggle-second" onClick={() => setShowSecond(prev => !prev)}>
        toggle-second
      </button>
    </ProjectRealtimeProvider>
  )
}
