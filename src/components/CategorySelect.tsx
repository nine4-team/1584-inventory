import { useState, useEffect, useCallback } from 'react'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { BudgetCategory } from '@/types'
import { useAccount } from '@/contexts/AccountContext'

interface CategorySelectProps {
  value?: string
  onChange?: (categoryId: string) => void
  label?: string
  error?: string
  helperText?: string
  disabled?: boolean
  includeArchived?: boolean
  id?: string
  className?: string
  required?: boolean
  asDropdown?: boolean
}

/**
 * CategorySelect Component
 * 
 * A reusable select component for choosing budget categories.
 * Automatically loads categories for the current account and hides archived categories by default.
 * 
 * @returns { id: string, name: string } format via onChange callback
 */
export default function CategorySelect({
  value,
  onChange,
  label = 'Budget Category',
  error,
  helperText,
  disabled = false,
  includeArchived = false,
  id,
  className,
  required = false,
  asDropdown = false
}: CategorySelectProps) {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadCategories = useCallback(async () => {
    if (!currentAccountId) return

    try {
      setIsLoading(true)
      setLoadError(null)
      const loadedCategories = await budgetCategoriesService.getCategories(
        currentAccountId,
        includeArchived
      )
      // Filter out archived categories on the frontend as a safety measure
      // This ensures archived categories never appear even if service returns them
      const filteredCategories = includeArchived 
        ? loadedCategories 
        : loadedCategories.filter(cat => !cat.isArchived)
      setCategories(filteredCategories)
    } catch (err) {
      console.error('Error loading budget categories:', err)
      setLoadError('Failed to load categories')
    } finally {
      setIsLoading(false)
    }
  }, [currentAccountId, includeArchived])

  useEffect(() => {
    // Wait for account to finish loading
    if (accountLoading) {
      return
    }

    if (currentAccountId) {
      loadCategories()
    } else {
      setIsLoading(false)
    }
  }, [currentAccountId, accountLoading, loadCategories])

  const handleRadioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const categoryId = e.target.value
    if (onChange) {
      onChange(categoryId)
    }
  }

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const categoryId = e.target.value
    if (onChange) {
      onChange(categoryId)
    }
  }

  // Show error from loading or from props
  const displayError = error || loadError

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700" style={{ color: '#374151' }}>
          {label}
        </label>
      )}

      <div className={className}>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading categories...</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-gray-500">No categories available</p>
        ) : (
          <>
            {asDropdown ? (
              <div>
                <select
                  id={id}
                  value={value || ''}
                  onChange={handleSelectChange}
                  disabled={disabled}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm"
                >
                  {!required && <option value="">None</option>}
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <fieldset id={id}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                  {required ? null : (
                    <div className="flex items-center">
                      <input
                        id={id ? `${id}-none` : 'category-none'}
                        name={id || 'category'}
                        type="radio"
                        value=""
                        checked={!value}
                        onChange={handleRadioChange}
                        disabled={disabled}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                      />
                      <label htmlFor={id ? `${id}-none` : 'category-none'} className="ml-2 block text-sm text-gray-900">
                        None
                      </label>
                    </div>
                  )}

                  {categories.map((category) => (
                    <div key={category.id} className="flex items-center">
                      <input
                        id={id ? `${id}-${category.id}` : `category-${category.id}`}
                        name={id || 'category'}
                        type="radio"
                        value={category.id}
                        checked={value === category.id}
                        onChange={handleRadioChange}
                        disabled={disabled}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                      />
                      <label htmlFor={id ? `${id}-${category.id}` : `category-${category.id}`} className="ml-2 block text-sm text-gray-900">
                        {category.name}
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
      </div>

      {displayError && (
        <p className="text-sm text-red-600" style={{ color: '#dc2626' }}>{displayError}</p>
      )}

      {helperText && !displayError && (
        <p className="text-sm text-gray-500" style={{ color: '#6b7280' }}>{helperText}</p>
      )}
    </div>
  )
}

/**
 * Hook to get categories as { id, name } array
 * Useful when you need the category list but not a select component
 */
export function useCategories(includeArchived: boolean = false): {
  categories: Array<{ id: string; name: string }>
  isLoading: boolean
  error: string | null
} {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (accountLoading || !currentAccountId) {
      if (!accountLoading && !currentAccountId) {
        setIsLoading(false)
        setError('No account found')
      }
      return
    }

    const loadCategories = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const loadedCategories = await budgetCategoriesService.getCategories(
          currentAccountId,
          includeArchived
        )
        // Filter out archived categories on the frontend as a safety measure
        // This ensures archived categories never appear even if service returns them
        const filteredCategories = includeArchived 
          ? loadedCategories 
          : loadedCategories.filter(cat => !cat.isArchived)
        setCategories(
          filteredCategories.map(cat => ({
            id: cat.id,
            name: cat.name
          }))
        )
      } catch (err) {
        console.error('Error loading budget categories:', err)
        setError('Failed to load categories')
      } finally {
        setIsLoading(false)
      }
    }

    loadCategories()
  }, [currentAccountId, accountLoading, includeArchived])

  return { categories, isLoading, error }
}

