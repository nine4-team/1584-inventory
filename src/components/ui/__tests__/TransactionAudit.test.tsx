import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TransactionAudit from '../TransactionAudit'
import type { Transaction, TransactionCompleteness } from '@/types'

const inventoryServiceMocks = vi.hoisted(() => ({
  getTransactionCompleteness: vi.fn<[], Promise<TransactionCompleteness>>()
}))

vi.mock('@/services/inventoryService', () => ({
  transactionService: {
    getTransactionCompleteness: inventoryServiceMocks.getTransactionCompleteness
  }
}))

vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({
    currentAccountId: 'test-account'
  })
}))

const completenessSnapshot: TransactionCompleteness = {
  itemsNetTotal: 500,
  itemsCount: 2,
  itemsMissingPriceCount: 0,
  transactionSubtotal: 725,
  completenessRatio: 500 / 725,
  completenessStatus: 'incomplete',
  missingTaxData: false,
  inferredTax: undefined,
  taxAmount: undefined,
  varianceDollars: -225,
  variancePercent: -31.034
}

describe('TransactionAudit amount immutability', () => {
  beforeEach(() => {
    inventoryServiceMocks.getTransactionCompleteness.mockImplementation(async () => ({ ...completenessSnapshot }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders completeness metrics without mutating subtotal', async () => {
    const transaction = {
      transactionId: 'txn-1',
      projectId: 'project-1',
      amount: '725.00',
      transactionType: 'Purchase',
      source: 'Vendor',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
      paymentMethod: 'Card'
    } as unknown as Transaction

    render(
      <TransactionAudit
        transaction={transaction}
        projectId="project-1"
        transactionItems={[]}
      />
    )

    await waitFor(() => expect(inventoryServiceMocks.getTransactionCompleteness).toHaveBeenCalledTimes(1))

    const subtotalDisplays = screen.getAllByText((content, element) => {
      const text = element?.textContent || ''
      return text.includes('$725.00')
    })
    expect(subtotalDisplays.length).toBeGreaterThan(0)
  })
})
