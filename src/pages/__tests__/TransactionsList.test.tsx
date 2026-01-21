import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TransactionsList from '../TransactionsList'
import type { Transaction } from '@/types'

vi.mock('@/hooks/useNavigationContext', () => ({
  useNavigationContext: () => ({
    buildContextUrl: (path: string) => path
  })
}))

vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({
    currentAccountId: 'account-1'
  })
}))

vi.mock('@/services/budgetCategoriesService', () => ({
  budgetCategoriesService: {
    getCategories: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('@/components/ContextLink', () => ({
  default: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}))

const makeTxn = (partial: Partial<Transaction>): Transaction => ({
  transactionId: partial.transactionId ?? 'txn-x',
  projectId: partial.projectId ?? 'project-1',
  transactionDate: partial.transactionDate ?? '2025-01-01',
  source: partial.source ?? 'Vendor',
  transactionType: partial.transactionType ?? 'Purchase',
  paymentMethod: partial.paymentMethod ?? 'Card',
  amount: partial.amount ?? '0.00',
  receiptEmailed: partial.receiptEmailed ?? false,
  createdAt: partial.createdAt ?? new Date().toISOString(),
  createdBy: partial.createdBy ?? 'user-1',
  notes: partial.notes,
  // Avoid triggering per-transaction completeness fetch in this component test
  needsReview: partial.needsReview ?? true
})

const renderList = (transactions: Transaction[]) => {
  return render(
    <MemoryRouter>
      <TransactionsList projectId="project-1" transactions={transactions} />
    </MemoryRouter>
  )
}

describe('TransactionsList sorting and filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters by source', async () => {
    const user = userEvent.setup()
    renderList([
      makeTxn({ transactionId: 't1', source: 'Wayfair', amount: '10.00', transactionDate: '2025-01-02' }),
      makeTxn({ transactionId: 't2', source: 'Home Depot', amount: '20.00', transactionDate: '2025-01-03' }),
    ])

    // Default shows both
    expect(screen.getByRole('heading', { name: 'Wayfair' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Home Depot' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Source' }))
    await user.click(screen.getByRole('button', { name: 'Wayfair' }))

    expect(screen.getByRole('heading', { name: 'Wayfair' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Home Depot' })).not.toBeInTheDocument()
  })

  it('searches by amount', async () => {
    const user = userEvent.setup()
    renderList([
      makeTxn({ transactionId: 't1', source: 'Alpha', amount: '10.00', transactionDate: '2025-01-02' }),
      makeTxn({ transactionId: 't2', source: 'Bravo', amount: '99.00', transactionDate: '2025-01-03' }),
    ])

    await user.type(screen.getByPlaceholderText('Search transactions by source or amount...'), '99')

    expect(screen.queryByRole('heading', { name: 'Alpha' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
  })

  it('sorts by price low-to-high', async () => {
    const user = userEvent.setup()
    renderList([
      makeTxn({ transactionId: 't1', source: 'First', amount: '100.00', transactionDate: '2025-01-02' }),
      makeTxn({ transactionId: 't2', source: 'Second', amount: '10.00', transactionDate: '2025-01-03' }),
      makeTxn({ transactionId: 't3', source: 'Third', amount: '50.00', transactionDate: '2025-01-04' }),
    ])

    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(screen.getByRole('button', { name: 'Price (low→high)' }))

    const headings = screen.getAllByRole('heading')
    const titles = headings.map(h => h.textContent || '')
    const secondIdx = titles.indexOf('Second')
    const thirdIdx = titles.indexOf('Third')
    const firstIdx = titles.indexOf('First')
    expect(secondIdx).toBeGreaterThanOrEqual(0)
    expect(thirdIdx).toBeGreaterThanOrEqual(0)
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeLessThan(thirdIdx)
    expect(thirdIdx).toBeLessThan(firstIdx)
  })

  it('sorts by source A→Z', async () => {
    const user = userEvent.setup()
    renderList([
      makeTxn({ transactionId: 't1', source: 'Wayfair', amount: '10.00', transactionDate: '2025-01-02' }),
      makeTxn({ transactionId: 't2', source: 'Amazon', amount: '20.00', transactionDate: '2025-01-03' }),
    ])

    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(screen.getByRole('button', { name: 'Source (A→Z)' }))

    const headings = screen.getAllByRole('heading')
    const titles = headings.map(h => h.textContent || '')
    expect(titles.indexOf('Amazon')).toBeLessThan(titles.indexOf('Wayfair'))
  })
})

