import { describe, it, expect } from 'vitest'
import { NetworkTimeoutError, withNetworkTimeout } from '../networkStatusService'

describe('networkStatusService helpers', () => {
  it('resolves operations that finish before timeout', async () => {
    const result = await withNetworkTimeout(async () => {
      return 'success'
    }, { timeoutMs: 50 })

    expect(result).toBe('success')
  })

  it('rejects with NetworkTimeoutError when operation exceeds timeout', async () => {
    await expect(
      withNetworkTimeout(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve('late'), 50)
          }) as Promise<string>,
        { timeoutMs: 5 }
      )
    ).rejects.toBeInstanceOf(NetworkTimeoutError)
  })
})
