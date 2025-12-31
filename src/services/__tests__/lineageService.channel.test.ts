import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockChannel = {
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
}

const channelInstances: MockChannel[] = []

const createChannelInstance = (): MockChannel => {
  const instance: MockChannel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockImplementation((callback: (status: string) => void) => {
      if (callback) {
        callback('SUBSCRIBED')
      }
      return instance
    }),
    unsubscribe: vi.fn(),
  }
  channelInstances.push(instance)
  return instance
}

const channelMock = vi.fn(createChannelInstance)

vi.mock('../supabase', () => ({
  supabase: {
    channel: channelMock,
  },
  getCurrentUser: vi.fn(),
}))

vi.mock('../databaseService', () => ({
  ensureAuthenticatedForDatabase: vi.fn(),
}))

describe('lineageService channel registry', () => {
  beforeEach(() => {
    channelMock.mockClear()
    channelInstances.length = 0
    vi.resetModules()
  })

  it('reuses a single account channel for multiple item subscriptions', async () => {
    const { lineageService } = await import('../lineageService')
    const unsubscribeA = lineageService.subscribeToItemLineageForItem('acct-1', 'item-1', () => {})
    const unsubscribeB = lineageService.subscribeToItemLineageForItem('acct-1', 'item-2', () => {})

    expect(channelMock).toHaveBeenCalledTimes(1)

    unsubscribeA()
    expect(channelInstances[0].unsubscribe).not.toHaveBeenCalled()

    unsubscribeB()
    expect(channelInstances[0].unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('creates distinct channels for different accounts', async () => {
    const { lineageService } = await import('../lineageService')
    const unsubscribeA = lineageService.subscribeToItemLineageForItem('acct-1', 'item-1', () => {})
    const unsubscribeB = lineageService.subscribeToItemLineageForItem('acct-2', 'item-2', () => {})

    expect(channelMock).toHaveBeenCalledTimes(2)

    unsubscribeA()
    unsubscribeB()

    expect(channelInstances[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(channelInstances[1].unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shares a channel between item and transaction listeners on the same account', async () => {
    const { lineageService } = await import('../lineageService')
    const unsubscribeItem = lineageService.subscribeToItemLineageForItem('acct-1', 'item-1', () => {})
    const unsubscribeTx = lineageService.subscribeToEdgesFromTransaction('acct-1', 'tx-1', () => {})

    expect(channelMock).toHaveBeenCalledTimes(1)

    unsubscribeItem()
    expect(channelInstances[0].unsubscribe).not.toHaveBeenCalled()

    unsubscribeTx()
    expect(channelInstances[0].unsubscribe).toHaveBeenCalledTimes(1)
  })
})
