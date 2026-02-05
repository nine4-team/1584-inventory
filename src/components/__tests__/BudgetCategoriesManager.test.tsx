import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BudgetCategoriesManager from '../BudgetCategoriesManager'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { useAccount } from '@/contexts/AccountContext'
import { getDefaultCategory, setDefaultCategory, setBudgetCategoryOrder } from '@/services/accountPresetsService'

// Mock the services and contexts
vi.mock('@/services/budgetCategoriesService')
vi.mock('@/contexts/AccountContext')
vi.mock('@/services/accountPresetsService')
vi.mock('@/hooks/useNetworkState', () => ({
  useNetworkState: () => ({ isOnline: true })
}))
vi.mock('../ui/OfflinePrerequisiteBanner', () => ({
  useOfflinePrerequisiteGate: () => ({ isReady: true, blockingReason: null })
}))

const mockCategories = [
  { id: 'cat-1', accountId: 'account-1', name: 'Design Fee', slug: 'design-fee', isArchived: false, metadata: null, createdAt: new Date(), updatedAt: new Date() },
  { id: 'cat-2', accountId: 'account-1', name: 'Furnishings', slug: 'furnishings', isArchived: false, metadata: null, createdAt: new Date(), updatedAt: new Date() },
  { id: 'cat-3', accountId: 'account-1', name: 'Archived Category', slug: 'archived', isArchived: true, metadata: null, createdAt: new Date(), updatedAt: new Date() }
]

describe('BudgetCategoriesManager', () => {
  const mockUseAccount = vi.mocked(useAccount)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAccount.mockReturnValue({
      currentAccountId: 'account-1',
      currentAccount: null,
      isOwner: false,
      isAdmin: false,
      loading: false
    })
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue(mockCategories.filter(c => !c.isArchived))
    vi.mocked(getDefaultCategory).mockResolvedValue(null)
    vi.mocked(setDefaultCategory).mockResolvedValue(undefined)
    vi.mocked(setBudgetCategoryOrder).mockResolvedValue(undefined)
  })

  it('should render categories list', async () => {
    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Design Fee')).toBeInTheDocument()
      expect(screen.getByText('Furnishings')).toBeInTheDocument()
    })
  })

  it('should show create form when create row is clicked', async () => {
    const user = userEvent.setup()
    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Click to create new category')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Click to create new category'))
    
    await waitFor(() => {
      expect(screen.getByText('Create budget category')).toBeInTheDocument()
      expect(screen.getByLabelText(/Category Name/)).toBeInTheDocument()
    })
  })

  it('should create a new category', async () => {
    const user = userEvent.setup()
    const newCategory = {
      id: 'cat-new',
      accountId: 'account-1',
      name: 'New Category',
      slug: 'new-category',
      isArchived: false,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    vi.mocked(budgetCategoriesService.createCategory).mockResolvedValue(newCategory)
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue([...mockCategories.filter(c => !c.isArchived), newCategory])

    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Click to create new category')).toBeInTheDocument()
    })

    // Click create row
    await user.click(screen.getByText('Click to create new category'))
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Category Name/)).toBeInTheDocument()
    })

    // Fill in form
    const nameInput = screen.getByLabelText(/Category Name/)
    
    await user.type(nameInput, 'New Category')

    // Submit form
    const saveButton = screen.getByRole('button', { name: /Create category/i })
    await user.click(saveButton)
    
    await waitFor(() => {
      expect(budgetCategoriesService.createCategory).toHaveBeenCalledWith(
        'account-1',
        'New Category'
      )
    })
  })

  it('should edit an existing category', async () => {
    const user = userEvent.setup()
    const updatedCategory = {
      ...mockCategories[0],
      name: 'Updated Design Fee',
      slug: 'updated-design-fee'
    }

    vi.mocked(budgetCategoriesService.updateCategory).mockResolvedValue(updatedCategory)
    vi.mocked(budgetCategoriesService.getCategories)
      .mockResolvedValueOnce(mockCategories.filter(c => !c.isArchived))
      .mockResolvedValueOnce([updatedCategory, mockCategories[1]])

    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Design Fee')).toBeInTheDocument()
    })

    // Open actions menu, then click Edit
    const actionButtons = screen.getAllByRole('button', { name: /Open actions/i })
    await user.click(actionButtons[0])
    await user.click(screen.getByText('Edit'))
    
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Design Fee')
      expect(nameInput).toBeInTheDocument()
    })

    // Update name
    const nameInput = screen.getByDisplayValue('Design Fee')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Design Fee')

    // Save
    const row = nameInput.closest('tr')
    if (!row) throw new Error('Edit row not found')
    const saveButton = within(row).getByRole('button', { name: /Save/ })
    await user.click(saveButton)
    
    await waitFor(() => {
      expect(budgetCategoriesService.updateCategory).toHaveBeenCalledWith(
        'account-1',
        'cat-1',
        expect.objectContaining({
          name: 'Updated Design Fee'
        })
      )
    })
  })

  it('should toggle itemization setting', async () => {
    const user = userEvent.setup()
    const updatedCategory = {
      ...mockCategories[0],
      metadata: { itemizationEnabled: false }
    }

    vi.mocked(budgetCategoriesService.updateCategory).mockResolvedValue(updatedCategory)
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue(mockCategories.filter(c => !c.isArchived))

    render(<BudgetCategoriesManager />)

    await waitFor(() => {
      expect(screen.getByText('Design Fee')).toBeInTheDocument()
    })

    const toggles = screen.getAllByRole('checkbox')
    await user.click(toggles[0])

    await waitFor(() => {
      expect(budgetCategoriesService.updateCategory).toHaveBeenCalledWith(
        'account-1',
        'cat-1',
        expect.objectContaining({
          metadata: expect.objectContaining({ itemizationEnabled: false })
        })
      )
    })
  })

  it('should archive a category', async () => {
    const user = userEvent.setup()
    const archivedCategory = { ...mockCategories[0], isArchived: true }

    vi.mocked(budgetCategoriesService.archiveCategory).mockResolvedValue(archivedCategory)
    vi.mocked(budgetCategoriesService.getCategories)
      .mockResolvedValueOnce(mockCategories.filter(c => !c.isArchived))
      .mockResolvedValueOnce([mockCategories[1]])

    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Design Fee')).toBeInTheDocument()
    })

    // Open actions menu, then click Archive
    const actionButtons = screen.getAllByRole('button', { name: /Open actions/i })
    await user.click(actionButtons[0])
    await user.click(screen.getByText('Archive'))
    
    await waitFor(() => {
      expect(budgetCategoriesService.archiveCategory).toHaveBeenCalledWith('account-1', 'cat-1')
    })
  })

  it('should prevent archiving category with transactions', async () => {
    // transaction-count based prevention removed from UI/service; this test is no longer applicable
  })

  // transaction counts removed from settings UI

  it('should hide archived categories when toggle is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue(mockCategories)

    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Design Fee')).toBeInTheDocument()
    })

    // Find "Hide Archived" button (default shows archived)
    const hideArchivedButton = screen.getByText(/Hide.*Archived/i)
    await user.click(hideArchivedButton)
    
    await waitFor(() => {
      expect(budgetCategoriesService.getCategories).toHaveBeenCalledWith('account-1', false)
      expect(screen.queryByText('Archived Category')).not.toBeInTheDocument()
    })
  })

  it('should handle bulk archive operations', async () => {
    // bulk operations removed from UI/service; test not applicable
  })

  it('should display error messages', async () => {
    vi.mocked(budgetCategoriesService.getCategories).mockRejectedValue(new Error('Failed to load categories'))

    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText(/Failed to load budget categories/)).toBeInTheDocument()
    })
  })

  it('should display success messages', async () => {
    const user = userEvent.setup()
    const newCategory = {
      id: 'cat-new',
      accountId: 'account-1',
      name: 'New Category',
      slug: 'new-category',
      isArchived: false,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    vi.mocked(budgetCategoriesService.createCategory).mockResolvedValue(newCategory)
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue([...mockCategories.filter(c => !c.isArchived), newCategory])

    render(<BudgetCategoriesManager />)
    
    await waitFor(() => {
      expect(screen.getByText('Click to create new category')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Click to create new category'))
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Category Name/)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/Category Name/), 'New Category')
    await user.click(screen.getByRole('button', { name: /Create category/i }))
    
    await waitFor(() => {
      expect(screen.getByText(/Category created successfully/)).toBeInTheDocument()
    })
  })
})

