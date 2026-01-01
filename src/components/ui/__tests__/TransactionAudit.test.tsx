import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TransactionAudit from '../TransactionAudit'
import type { Item, Transaction, TransactionCompleteness } from '@/types'

const inventoryServiceMocks = vi.hoisted(() => ({
  getTransactionCompleteness: vi.fn<[], Promise<TransactionCompleteness>>(),
  getSuggestedItemsForTransaction: vi.fn(),
  addItemToTransaction: vi.fn()
}))

vi.mock('@/services/inventoryService', () => ({
  transactionService: {
    getTransactionCompleteness: inventoryServiceMocks.getTransactionCompleteness,
    getSuggestedItemsForTransaction: inventoryServiceMocks.getSuggestedItemsForTransaction
  },
  unifiedItemsService: {
    addItemToTransaction: inventoryServiceMocks.addItemToTransaction
  }
}))

vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({
    currentAccountId: 'test-account'
  })
}))

vi.mock('../ToastContext', () => ({
  useToast: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn()
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
    inventoryServiceMocks.getSuggestedItemsForTransaction.mockResolvedValue([
      {
        itemId: 'suggest-1',
        description: 'Lamp',
        sku: 'SKU-1',
        purchasePrice: '75.00'
      } as unknown as Item
    ])
    inventoryServiceMocks.addItemToTransaction.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the displayed subtotal stable after adding suggested items', async () => {
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

    const attachedItem = {
      itemId: 'attached-1',
      description: 'Chair',
      sku: 'CHAIR-1',
      purchasePrice: '250.00'
    } as unknown as Item

    inventoryServiceMocks.addItemToTransaction.mockImplementation(async () => {
      transaction.amount = '999.99'
    })

    const Wrapper = () => {
      const [items, setItems] = useState<Item[]>([])
      return (
        <TransactionAudit
          transaction={transaction}
          projectId="project-1"
          transactionItems={items}
          onItemsUpdated={() => setItems(prev => [...prev, attachedItem])}
        />
      )
    }

    render(<Wrapper />)

    await waitFor(() => expect(inventoryServiceMocks.getTransactionCompleteness).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(inventoryServiceMocks.getSuggestedItemsForTransaction).toHaveBeenCalledTimes(1))

    const addButton = await screen.findByRole('button', { name: /Add/i })
    fireEvent.click(addButton)

    await waitFor(() => expect(inventoryServiceMocks.addItemToTransaction).toHaveBeenCalledTimes(1))
    expect(transaction.amount).toBe('999.99')

    await waitFor(() => expect(inventoryServiceMocks.getTransactionCompleteness).toHaveBeenCalledTimes(2))

    const subtotalDisplays = screen.getAllByText((content, element) => {
      const text = element?.textContent || ''
      return text.includes('$725.00')
    })
    expect(subtotalDisplays.length).toBeGreaterThan(0)
  })
})
