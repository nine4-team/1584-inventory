// React import unused in modern JSX runtime; removed to fix TS6133
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import BudgetProgress from '../BudgetProgress'
import { BudgetCategory, ProjectBudgetCategories, Transaction } from '@/types'

const categoryIds = {
  furnishings: 'cat-furnishings',
  install: 'cat-install',
  storageReceiving: 'cat-storage-receiving',
  propertyManagement: 'cat-property-management',
  kitchen: 'cat-kitchen',
  designFee: 'cat-design-fee',
  fuel: 'cat-fuel'
}

vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({
    currentAccountId: 'account-1',
    loading: false
  })
}))

vi.mock('@/components/CategorySelect', () => ({
  useCategories: () => ({
    categories: [
      { id: categoryIds.furnishings, name: BudgetCategory.FURNISHINGS },
      { id: categoryIds.install, name: BudgetCategory.INSTALL },
      { id: categoryIds.storageReceiving, name: BudgetCategory.STORAGE_RECEIVING },
      { id: categoryIds.propertyManagement, name: BudgetCategory.PROPERTY_MANAGEMENT },
      { id: categoryIds.kitchen, name: BudgetCategory.KITCHEN },
      { id: categoryIds.designFee, name: BudgetCategory.DESIGN_FEE },
      { id: categoryIds.fuel, name: BudgetCategory.FUEL }
    ],
    isLoading: false,
    error: null
  })
}))

const makeTransaction = (overrides: Partial<Transaction>): Transaction => ({
  transactionId: overrides.transactionId || Math.random().toString(36).slice(2),
  transactionDate: overrides.transactionDate || new Date().toISOString(),
  source: overrides.source || 'Test',
  transactionType: overrides.transactionType || 'Purchase',
  paymentMethod: overrides.paymentMethod || 'Card',
  amount: overrides.amount || '0',
  budgetCategory: overrides.budgetCategory,
  receiptEmailed: false,
  createdAt: new Date().toISOString(),
  createdBy: 'test',
  status: overrides.status || 'completed',
})

describe('BudgetProgress calculations', () => {
  test('Furnishings handles purchases and returns correctly', async () => {
    const budgetCategories: ProjectBudgetCategories = {
      [categoryIds.furnishings]: 1000
    }

    const transactions: Transaction[] = [
      makeTransaction({ amount: '300', categoryId: categoryIds.furnishings, budgetCategory: BudgetCategory.FURNISHINGS, transactionType: 'Purchase' }),
      makeTransaction({ amount: '200', categoryId: categoryIds.furnishings, budgetCategory: BudgetCategory.FURNISHINGS, transactionType: 'Purchase' }),
      makeTransaction({ amount: '100', categoryId: categoryIds.furnishings, budgetCategory: BudgetCategory.FURNISHINGS, transactionType: 'Return' })
    ]

    const { container } = render(
      <BudgetProgress
        budget={1000}
        budgetCategories={budgetCategories}
        transactions={transactions}
      />
    )

    // Wait for async calculations to finish
    await waitFor(() => expect(screen.getByText(/Furnishings Budget/)).toBeInTheDocument())

    // Spent should be 300 + 200 - 100 = 400
    expect(screen.getByText(/\$400\s+spent/)).toBeInTheDocument()
    // Remaining should be 1000 - 400 = 600 (text may be split across elements)
    const remainingElements = screen.getAllByText((content, element) => {
      const hasText = element?.textContent?.includes('$600') && element?.textContent?.includes('remaining')
      return Boolean(hasText)
    })
    expect(remainingElements.length).toBeGreaterThan(0)

    // Progress bar width should be 40%
    const styledDivs = Array.from(container.querySelectorAll('div[style]'))
    const has40 = styledDivs.some(d => (d as HTMLElement).style.width === '40%')
    expect(has40).toBe(true)
  })

  test('Install category calculates correctly with multiple purchases', async () => {
    const budgetCategories: ProjectBudgetCategories = {
      [categoryIds.install]: 800
    }

    const transactions: Transaction[] = [
      makeTransaction({ amount: '300', categoryId: categoryIds.install, budgetCategory: BudgetCategory.INSTALL, transactionType: 'Purchase' }),
      makeTransaction({ amount: '200', categoryId: categoryIds.install, budgetCategory: BudgetCategory.INSTALL, transactionType: 'Purchase' })
    ]

    const { container } = render(
      <BudgetProgress
        budget={800}
        budgetCategories={budgetCategories}
        transactions={transactions}
      />
    )

    const showAllButton = await screen.findByRole('button', { name: /Show All Budget Categories/i })
    fireEvent.click(showAllButton)
    await waitFor(() => expect(screen.getByText(/Install Budget/)).toBeInTheDocument())

    // Spent should be 500
    expect(screen.getByText(/\$500\s+spent/)).toBeInTheDocument()
    // Remaining should be 300 (text may be split across elements)
    const remainingElements = screen.getAllByText((content, element) => {
      const hasText = element?.textContent?.includes('$300') && element?.textContent?.includes('remaining')
      return Boolean(hasText)
    })
    expect(remainingElements.length).toBeGreaterThan(0)

    const styledDivs = Array.from(container.querySelectorAll('div[style]'))
    const hasPercent = styledDivs.some(d => (d as HTMLElement).style.width === '62.5%')
    // Allow slight variance depending on rounding: expect a width that matches 62.5% or 63%
    const has63 = styledDivs.some(d => (d as HTMLElement).style.width === '63%')
    expect(hasPercent || has63).toBe(true)
  })

  test('Storage & Receiving handles a return and purchase', async () => {
    const budgetCategories: ProjectBudgetCategories = {
      [categoryIds.storageReceiving]: 400
    }

    const transactions: Transaction[] = [
      makeTransaction({ amount: '250', categoryId: categoryIds.storageReceiving, budgetCategory: BudgetCategory.STORAGE_RECEIVING, transactionType: 'Purchase' }),
      makeTransaction({ amount: '50', categoryId: categoryIds.storageReceiving, budgetCategory: BudgetCategory.STORAGE_RECEIVING, transactionType: 'Return' })
    ]

    const { container } = render(
      <BudgetProgress
        budget={400}
        budgetCategories={budgetCategories}
        transactions={transactions}
      />
    )

    const showAllButton = await screen.findByRole('button', { name: /Show All Budget Categories/i })
    fireEvent.click(showAllButton)
    await waitFor(() => expect(screen.getByText(/Storage & Receiving Budget/)).toBeInTheDocument())

    // Spent should be 200
    expect(screen.getByText(/\$200\s+spent/)).toBeInTheDocument()
    // Remaining should be 200 (text may be split across elements)
    const remainingElements = screen.getAllByText((content, element) => {
      const hasText = element?.textContent?.includes('$200') && element?.textContent?.includes('remaining')
      return Boolean(hasText)
    })
    expect(remainingElements.length).toBeGreaterThan(0)

    const styledDivs = Array.from(container.querySelectorAll('div[style]'))
    const has50 = styledDivs.some(d => (d as HTMLElement).style.width === '50%')
    expect(has50).toBe(true)
  })

  test('Fuel category with transactions renders after expanding', async () => {
    const budgetCategories: ProjectBudgetCategories = {
    }

    const transactions: Transaction[] = [
      makeTransaction({ amount: '50', categoryId: categoryIds.fuel, budgetCategory: BudgetCategory.FUEL, transactionType: 'Purchase' })
    ]

    render(
      <BudgetProgress
        budget={0}
        budgetCategories={budgetCategories}
        transactions={transactions}
      />
    )

    const showAllButton = await screen.findByRole('button', { name: /Show All Budget Categories/i })
    fireEvent.click(showAllButton)

    await waitFor(() => expect(screen.getByText(/Fuel Budget/)).toBeInTheDocument())
  })

  test('Design Fee tracks received and remaining correctly', async () => {
    const budgetCategories: ProjectBudgetCategories = {
    }

    const designFeeAmount = 1000

    const transactions: Transaction[] = [
      makeTransaction({ amount: '400', categoryId: categoryIds.designFee, budgetCategory: BudgetCategory.DESIGN_FEE, transactionType: 'Purchase' }),
      makeTransaction({ amount: '100', categoryId: categoryIds.designFee, budgetCategory: BudgetCategory.DESIGN_FEE, transactionType: 'Return' })
    ]

    const { container } = render(
      <BudgetProgress
        budget={0}
        designFee={designFeeAmount}
        budgetCategories={budgetCategories}
        transactions={transactions}
        previewMode
      />
    )

    await waitFor(() => expect(screen.getByText(/Design Fee/)).toBeInTheDocument())

    // Received should be 400 - 100 = 300
    expect(screen.getByText(/\$300\s+received/)).toBeInTheDocument()
    // Remaining should be 1000 - 300 = 700 (text may be split across elements)
    const remainingElements = screen.getAllByText((content, element) => {
      const hasText = element?.textContent?.includes('$700') && element?.textContent?.includes('remaining')
      return Boolean(hasText)
    })
    expect(remainingElements.length).toBeGreaterThan(0)

    // Progress bar should be 30%
    const styledDivs = Array.from(container.querySelectorAll('div[style]'))
    const has30 = styledDivs.some(d => (d as HTMLElement).style.width === '30%')
    expect(has30).toBe(true)
  })

  test('Kitchen caps at 100% and shows negative remaining when over budget', async () => {
    const budgetCategories: ProjectBudgetCategories = {
      [categoryIds.kitchen]: 500
    }

    const transactions: Transaction[] = [
      makeTransaction({ amount: '600', categoryId: categoryIds.kitchen, budgetCategory: BudgetCategory.KITCHEN, transactionType: 'Purchase' })
    ]

    const { container } = render(
      <BudgetProgress
        budget={500}
        budgetCategories={budgetCategories}
        transactions={transactions}
      />
    )

    const showAllButton = await screen.findByRole('button', { name: /Show All Budget Categories/i })
    fireEvent.click(showAllButton)
    await waitFor(() => expect(screen.getByText(/Kitchen Budget/)).toBeInTheDocument())

    // Spent should be 600
    expect(screen.getByText(/\$600\s+spent/)).toBeInTheDocument()
    // Remaining should be 500 - 600 = -100 (text may be split across elements)
    const remainingElements = screen.getAllByText((content, element) => {
      const hasText = element?.textContent?.includes('$-100') && element?.textContent?.includes('remaining')
      return Boolean(hasText)
    })
    expect(remainingElements.length).toBeGreaterThan(0)

    // Progress should be capped to 100%
    const styledDivs = Array.from(container.querySelectorAll('div[style]'))
    const has100 = styledDivs.some(d => (d as HTMLElement).style.width === '100%')
    expect(has100).toBe(true)
  })

  test('Property Management counts returns correctly', async () => {
    const budgetCategories: ProjectBudgetCategories = {
      [categoryIds.propertyManagement]: 200
    }

    const transactions: Transaction[] = [
      makeTransaction({ amount: '100', categoryId: categoryIds.propertyManagement, budgetCategory: BudgetCategory.PROPERTY_MANAGEMENT, transactionType: 'Purchase' }),
      makeTransaction({ amount: '50', categoryId: categoryIds.propertyManagement, budgetCategory: BudgetCategory.PROPERTY_MANAGEMENT, transactionType: 'Return' })
    ]

    const { container } = render(
      <BudgetProgress
        budget={200}
        budgetCategories={budgetCategories}
        transactions={transactions}
      />
    )

    const showAllButton = await screen.findByRole('button', { name: /Show All Budget Categories/i })
    fireEvent.click(showAllButton)
    await waitFor(() => expect(screen.getByText(/Property Management Budget/)).toBeInTheDocument())

    // Spent should be 100 - 50 = 50
    expect(screen.getByText(/\$50\s+spent/)).toBeInTheDocument()
    // Remaining should be 200 - 50 = 150 (text may be split across elements)
    const remainingElements = screen.getAllByText((content, element) => {
      const hasText = element?.textContent?.includes('$150') && element?.textContent?.includes('remaining')
      return Boolean(hasText)
    })
    expect(remainingElements.length).toBeGreaterThan(0)

    // Progress should be 25%
    const styledDivs = Array.from(container.querySelectorAll('div[style]'))
    const has25 = styledDivs.some(d => (d as HTMLElement).style.width === '25%')
    expect(has25).toBe(true)
  })
})


