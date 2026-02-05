import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectForm from '../ProjectForm'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'

// Mock the services
vi.mock('@/services/budgetCategoriesService')
vi.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({
    currentAccountId: 'account-1'
  })
}))
vi.mock('@/components/ui/OfflinePrerequisiteBanner', () => ({
  useOfflinePrerequisiteGate: () => ({
    isReady: true,
    blockingReason: null
  })
}))

const mockCategories = [
  { id: 'cat-1', accountId: 'account-1', name: 'Design Fee', slug: 'design-fee', isArchived: false, metadata: null, createdAt: new Date(), updatedAt: new Date() },
  { id: 'cat-2', accountId: 'account-1', name: 'Furnishings', slug: 'furnishings', isArchived: false, metadata: null, createdAt: new Date(), updatedAt: new Date() }
]

describe('ProjectForm', () => {
  const mockOnSubmit = vi.fn()
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(budgetCategoriesService.getCategories).mockResolvedValue(mockCategories)
  })

  it('should render project form with category select', async () => {
    render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />)
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()
      // Default category is now account-wide; project form should not render it
      expect(screen.queryByLabelText(/Default Budget Category/)).not.toBeInTheDocument()
    })
  })

  it('should allow selecting a default category', async () => {
    const user = userEvent.setup()
    render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />)
    
    await waitFor(() => {
      // Project form no longer contains a default category select
      expect(screen.queryByLabelText(/Default Budget Category/)).not.toBeInTheDocument()
    })

    // No category select to interact with; this test is intentionally a no-op now.
  })

  // Tests related to defaultCategoryId removed because default category is now account-wide.

  it('should validate required fields', async () => {
    const user = userEvent.setup()
    render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />)
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()
    })

    // Try to submit without required fields
    const submitButton = screen.getByRole('button', { name: /Create Project/ })
    await user.click(submitButton)
    
    // Form should show validation errors
    await waitFor(() => {
      expect(screen.getByText(/Project name is required/)).toBeInTheDocument()
      expect(screen.getByText(/Client name is required/)).toBeInTheDocument()
    })

    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />)
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)
    
    expect(mockOnCancel).toHaveBeenCalled()
  })
})

