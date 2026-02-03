import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExistingItemsPicker from '../ExistingItemsPicker'
import type { Item } from '@/types'

const inventoryServiceMocks = vi.hoisted(() => ({
  getItemsByProject: vi.fn(),
  searchItemsOutsideProject: vi.fn(),
  getSuggestedItemsForTransaction: vi.fn()
}))

const toastMocks = vi.hoisted(() => ({
  showError: vi.fn()
}))

vi.mock('@/services/inventoryService', () => ({
  unifiedItemsService: {
    getItemsByProject: inventoryServiceMocks.getItemsByProject,
    searchItemsOutsideProject: inventoryServiceMocks.searchItemsOutsideProject
  },
  transactionService: {
    getSuggestedItemsForTransaction: inventoryServiceMocks.getSuggestedItemsForTransaction
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
  default: ({ item, showCheckbox, isSelected, onSelect, footer }: any) => (
    <div>
      <div>{item.description}</div>
      {footer ? <div>{footer}</div> : null}
      {showCheckbox && (
        <input
          type="checkbox"
          aria-label={`select-${item.itemId}`}
          checked={Boolean(isSelected)}
          onChange={(event) => onSelect?.(item.itemId, event.target.checked)}
        />
      )}
    </div>
  )
}))

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

describe('ExistingItemsPicker (space mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inventoryServiceMocks.getItemsByProject.mockResolvedValue([])
    inventoryServiceMocks.searchItemsOutsideProject.mockResolvedValue([])
  })

  it('shows the outside tab with results', async () => {
    const user = userEvent.setup()
    const outsideItem = buildItem({ itemId: 'outside-1', description: 'Outside lamp', projectId: 'project-2' })
    inventoryServiceMocks.searchItemsOutsideProject.mockResolvedValue([outsideItem])

    render(
      <ExistingItemsPicker
        mode="space"
        projectId="project-1"
        includeOutside
        includeSuggested={false}
        onAddItems={vi.fn()}
      />
    )

    const outsideTab = await screen.findByRole('button', { name: /Outside \(1\)/ })
    await user.click(outsideTab)

    await screen.findByText('Outside lamp')
  })

  it('disables transaction-linked outside items', async () => {
    const user = userEvent.setup()
    const linkedItem = buildItem({
      itemId: 'linked-1',
      description: 'Linked chair',
      projectId: 'project-2',
      transactionId: 'txn-1'
    })
    inventoryServiceMocks.searchItemsOutsideProject.mockResolvedValue([linkedItem])

    const isItemDisabled = (item: Item) => {
      const isOutsideItem = item.projectId !== 'project-1'
      if (isOutsideItem && item.transactionId) {
        return {
          disabled: true,
          reason: 'This item is tied to a transaction; move the transaction instead.'
        }
      }
      return { disabled: false }
    }

    render(
      <ExistingItemsPicker
        mode="space"
        projectId="project-1"
        includeOutside
        includeSuggested={false}
        isItemDisabled={isItemDisabled}
        onAddItems={vi.fn()}
      />
    )

    const outsideTab = await screen.findByRole('button', { name: /Outside \(1\)/ })
    await user.click(outsideTab)

    await screen.findByText('Linked chair')
    await waitFor(() => {
      expect(screen.queryByLabelText('select-linked-1')).toBeNull()
    })
    expect(screen.getByText('This item is tied to a transaction; move the transaction instead.')).toBeInTheDocument()
  })
})
