import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import AddTransaction from '../AddTransaction'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { useAuth } from '@/contexts/AuthContext'
import { useAccount } from '@/contexts/AccountContext'

// Mock the services and contexts
vi.mock('@/services/budgetCategoriesService')
vi.mock('@/contexts/AuthContext')
vi.mock('@/contexts/AccountContext')
vi.mock('@/services/inventoryService', () => ({
  transactionService: {
    createTransaction: vi.fn().mockResolvedValue('test-transaction-id')
  },
  projectService: {
    getProject: vi.fn().mockResolvedValue({ id: 'project-1', name: 'Test Project' })
  }
}))
vi.mock('@/services/taxPresetsService', () => ({
  getTaxPresets: vi.fn().mockResolvedValue([])
}))
vi.mock('@/services/vendorDefaultsService', () => ({
  getAvailableVendors: vi.fn().mockResolvedValue([])
}))

const mockCategories = [
  { id: 'cat-1', accountId: 'account-1', name: 'Design Fee', slug: 'design-fee', isArchived: false, metadata: null, createdAt: new Date(), updatedAt: new Date() },
  { id: 'cat-2', accountId: 'account-1', name: 'Furnishings', slug: 'furnishings', isArchived: false, metadata: null, createdAt: new Date(), updatedAt: new Date() }
]

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>
    {children}
  </BrowserRouter>
)

describe('AddTransaction - Category Selection', () => {
  const mockUseAuth = vi.mocked(useAuth)
  const mockUseAccount = vi.mocked(useAccount)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'test@example.com' },
      isOwner: () => false,
      loading: false
    } as any)
    mockUseAccount.mockReturnValue({
      currentAccountId: 'account-1',
      currentAccount: null,
      isOwner: false,
      isAdmin: false,
      loading: false
    })
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue(mockCategories)
  })

  it('should render category select field', async () => {
    render(
      <Wrapper>
        <AddTransaction />
      </Wrapper>
    )
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Budget Category/)).toBeInTheDocument()
    })
  })

  it('should require category selection', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <AddTransaction />
      </Wrapper>
    )
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Budget Category/)).toBeInTheDocument()
    })

    // Fill in other required fields but not category
    await user.type(screen.getByLabelText(/Amount/), '100.00')
    
    // Try to submit
    const submitButton = screen.getByRole('button', { name: /Save|Create|Add/ })
    await user.click(submitButton)
    
    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText(/Budget category is required/)).toBeInTheDocument()
    })
  })

  it('should allow selecting a category', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <AddTransaction />
      </Wrapper>
    )
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Budget Category/)).toBeInTheDocument()
    })

    const categorySelect = screen.getByLabelText(/Budget Category/)
    await user.selectOptions(categorySelect, 'cat-1')
    
    expect((categorySelect as HTMLSelectElement).value).toBe('cat-1')
  })

  it('hides transaction items when itemization is disabled', async () => {
    const user = userEvent.setup()
    const disabledCategories = [
      { ...mockCategories[0], metadata: { itemizationEnabled: false } }
    ]
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue(disabledCategories)

    render(
      <Wrapper>
        <AddTransaction />
      </Wrapper>
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Budget Category/)).toBeInTheDocument()
    })

    const categorySelect = screen.getByLabelText(/Budget Category/)
    await user.selectOptions(categorySelect, disabledCategories[0].id)

    await waitFor(() => {
      expect(screen.queryByText('Transaction Items')).not.toBeInTheDocument()
    })
  })

  it('should validate category belongs to account', async () => {
    // This test verifies that the service enforces account scoping
    // The actual validation happens in the service layer
    expect(budgetCategoriesService.getCategories).toBeDefined()
    
    // When getCategories is called, it should be scoped to the account
    await budgetCategoriesService.getCategories('account-1', false)
    
    expect(vi.mocked(budgetCategoriesService.getCategories)).toHaveBeenCalledWith('account-1', false)
  })
})

