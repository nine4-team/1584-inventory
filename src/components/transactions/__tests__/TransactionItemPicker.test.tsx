import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionItemPicker from '../TransactionItemPicker'
import type { Item, Transaction } from '@/types'

const inventoryServiceMocks = vi.hoisted(() => ({
  getSuggestedItemsForTransaction: vi.fn(),
  getItemsByProject: vi.fn(),
  searchItemsOutsideProject: vi.fn(),
  updateItem: vi.fn(),
  assignItemToTransaction: vi.fn(),
  assignItemsToTransaction: vi.fn()
}))

const toastMocks = vi.hoisted(() => ({
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

const displayInfoMocks = vi.hoisted(() => ({
  getTransactionDisplayInfo: vi.fn()
}))

vi.mock('@/services/inventoryService', () => ({
  transactionService: {
    getSuggestedItemsForTransaction: inventoryServiceMocks.getSuggestedItemsForTransaction
  },
  unifiedItemsService: {
    getItemsByProject: inventoryServiceMocks.getItemsByProject,
    searchItemsOutsideProject: inventoryServiceMocks.searchItemsOutsideProject,
    updateItem: inventoryServiceMocks.updateItem,
    assignItemToTransaction: inventoryServiceMocks.assignItemToTransaction,
    assignItemsToTransaction: inventoryServiceMocks.assignItemsToTransaction
  }
}))

vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({
    currentAccountId: 'account-1'
  })
}))

vi.mock('@/components/ui/ToastContext', () => ({
  useToast: () => toastMocks
}))

vi.mock('@/components/items/ItemPreviewCard', () => ({
  __esModule: true,
  default: ({ item, showCheckbox, isSelected, onSelect }: any) => (
    <div>
      <div>{item.description}</div>
      {showCheckbox && (
        <input
          type="checkbox"
          aria-label={`select-${item.itemId ?? item.id}`}
          checked={Boolean(isSelected)}
          onChange={(event) => onSelect?.(item.itemId ?? item.id, event.target.checked)}
        />
      )}
    </div>
  )
}))

vi.mock('@/utils/transactionDisplayUtils', () => ({
  getTransactionDisplayInfo: displayInfoMocks.getTransactionDisplayInfo
}))

const buildTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  transactionId: 'txn-1',
  transactionDate: new Date().toISOString(),
  source: 'Vendor',
  transactionType: 'Purchase',
  paymentMethod: 'Card',
  amount: '100.00',
  receiptEmailed: false,
  createdAt: new Date().toISOString(),
  createdBy: 'user-1',
  ...overrides
})

const buildItem = (overrides: Partial<Item> = {}): Item => ({
  itemId: 'item-1',
  description: 'Item',
  source: 'Vendor',
  sku: 'SKU-1',
  paymentMethod: 'Card',
  qrKey: 'qr-1',
  bookmark: false,
  dateCreated: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  ...overrides
})

describe('TransactionItemPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inventoryServiceMocks.getSuggestedItemsForTransaction.mockResolvedValue([])
    inventoryServiceMocks.getItemsByProject.mockResolvedValue([])
    inventoryServiceMocks.searchItemsOutsideProject.mockResolvedValue([])
    inventoryServiceMocks.updateItem.mockResolvedValue(undefined)
    inventoryServiceMocks.assignItemToTransaction.mockResolvedValue(undefined)
    inventoryServiceMocks.assignItemsToTransaction.mockResolvedValue(undefined)
    displayInfoMocks.getTransactionDisplayInfo.mockResolvedValue({ title: 'Other Tx', amount: '$50.00' })
  })

  it('auto-switches to the first tab with results', async () => {
    const transaction = buildTransaction({ projectId: 'project-1' })
    const projectItem = buildItem({ itemId: 'item-project', description: 'Project item' })
    inventoryServiceMocks.getItemsByProject.mockResolvedValue([projectItem])

    render(
      <TransactionItemPicker
        transaction={transaction}
        projectId="project-1"
        transactionItemIds={[]}
      />
    )

    const projectTab = await screen.findByRole('button', { name: /Project \(1\)/ })
    await waitFor(() => {
      expect(projectTab.className).toContain('border-primary-600')
    })
  })

  it('selects grouped items via group checkbox', async () => {
    const user = userEvent.setup()
    const transaction = buildTransaction({ projectId: 'project-1' })
    const groupedItems = [
      buildItem({ itemId: 'item-1', sku: 'SKU-GROUP', description: 'Chair', purchasePrice: '10', disposition: 'purchased' }),
      buildItem({ itemId: 'item-2', sku: 'SKU-GROUP', description: 'Chair', purchasePrice: '10', disposition: 'purchased' })
    ]
    inventoryServiceMocks.getSuggestedItemsForTransaction.mockResolvedValue(groupedItems)

    render(
      <TransactionItemPicker
        transaction={transaction}
        projectId="project-1"
        transactionItemIds={[]}
      />
    )

    const groupCheckbox = await screen.findByLabelText(/Select group of 2 items/)
    await user.click(groupCheckbox)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add selected \(2\)/ })).toBeInTheDocument()
    })
  })

  it('requires confirmation before reassigning conflicting items', async () => {
    const user = userEvent.setup()
    const transaction = buildTransaction({ projectId: 'project-1' })
    const conflictItem = buildItem({
      itemId: 'item-conflict',
      description: 'Conflicted item',
      transactionId: 'txn-prev',
      projectId: 'project-1'
    })
    inventoryServiceMocks.getSuggestedItemsForTransaction.mockResolvedValue([conflictItem])

    render(
      <TransactionItemPicker
        transaction={transaction}
        projectId="project-1"
        transactionItemIds={[]}
      />
    )

    const addButton = await screen.findByRole('button', { name: 'Add' })
    await user.click(addButton)

    await screen.findByRole('dialog', { name: /Reassign item\?/ })
    expect(inventoryServiceMocks.assignItemToTransaction).not.toHaveBeenCalled()

    const confirmButton = screen.getByRole('button', { name: 'Reassign items' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(inventoryServiceMocks.assignItemToTransaction).toHaveBeenCalledTimes(1)
    })
    expect(inventoryServiceMocks.assignItemToTransaction).toHaveBeenCalledWith(
      'account-1',
      'txn-1',
      'item-conflict',
      { itemPreviousTransactionId: 'txn-prev' }
    )
  })

  it('labels Add/Added actions appropriately', async () => {
    const transaction = buildTransaction({ projectId: 'project-1' })
    const items = [
      buildItem({ itemId: 'item-added', description: 'Already added', transactionId: 'txn-1', projectId: 'project-1', sku: 'SKU-ADD' }),
      buildItem({ itemId: 'item-in-scope', description: 'In scope', projectId: 'project-1', sku: 'SKU-IN' }),
      buildItem({ itemId: 'item-out', description: 'Out of scope', projectId: 'project-2', sku: 'SKU-OUT' })
    ]
    inventoryServiceMocks.getSuggestedItemsForTransaction.mockResolvedValue(items)

    render(
      <TransactionItemPicker
        transaction={transaction}
        projectId="project-1"
        transactionItemIds={[]}
      />
    )

    const addedButton = await screen.findByRole('button', { name: 'Added' })
    expect(addedButton).toBeDisabled()
    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    expect(addButtons).toHaveLength(2)
    addButtons.forEach(button => {
      expect(button).toBeEnabled()
    })
  })
})
