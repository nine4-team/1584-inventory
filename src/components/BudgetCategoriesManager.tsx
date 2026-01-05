import { useState, useEffect, useCallback } from 'react'
import { Save, AlertCircle, Plus, Edit2, Archive, ArchiveRestore, X, Trash2, GripVertical } from 'lucide-react'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { getDefaultCategory, setDefaultCategory, setBudgetCategoryOrder } from '@/services/accountPresetsService'
import { BudgetCategory } from '@/types'
import { useAccount } from '@/contexts/AccountContext'
import { Button } from './ui/Button'
import CategorySelect from '@/components/CategorySelect'

export default function BudgetCategoriesManager() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [formData, setFormData] = useState({ name: '' })
  const [selectedDefaultCategoryId, setSelectedDefaultCategoryId] = useState<string | null>(null)
  const [isSavingDefault, setIsSavingDefault] = useState(false)
  const [defaultSaveMessage, setDefaultSaveMessage] = useState<string | null>(null)
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null)
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)

  const loadCategories = useCallback(async () => {
    if (!currentAccountId) return

    try {
      setIsLoading(true)
      setError(null)
      const loadedCategories = await budgetCategoriesService.getCategories(
        currentAccountId,
        showArchived
      )
      setCategories(loadedCategories)
      // Load saved account-wide default category from Postgres account_presets
      try {
        const defaultCategory = await getDefaultCategory(currentAccountId)
        setSelectedDefaultCategoryId(defaultCategory)
      } catch (err) {
        console.error('Error loading account default category:', err)
        setSelectedDefaultCategoryId(null)
      }
    } catch (err) {
      console.error('Error loading budget categories:', err)
      setError('Failed to load budget categories')
    } finally {
      setIsLoading(false)
    }
  }, [currentAccountId, showArchived])

  useEffect(() => {
    // Wait for account to finish loading
    if (accountLoading) {
      return
    }

    if (currentAccountId) {
      loadCategories()
    } else {
      // If no account ID after loading completes, stop loading
      setIsLoading(false)
      setError('No account found. Please ensure you are logged in and have an account.')
    }
  }, [currentAccountId, accountLoading, loadCategories])

  const handleStartCreate = () => {
    setCreating(true)
    setEditingId(null)
    setFormData({ name: '' })
    setError(null)
    setSuccessMessage(null)
  }

  const handleStartEdit = (category: BudgetCategory) => {
    setEditingId(category.id)
    setCreating(false)
    setFormData({ name: category.name })
    setError(null)
    setSuccessMessage(null)
  }

  const handleCancel = () => {
    setCreating(false)
    setEditingId(null)
    setFormData({ name: '' })
  }

  const handleFormChange = (field: 'name' | 'slug', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError(null)
    setSuccessMessage(null)
  }

  const handleSave = async () => {
    if (!currentAccountId) {
      setError('Account ID is required')
      return
    }

    if (!formData.name.trim()) {
      setError('Category name is required')
      return
    }

    // only name is required in the simplified UI

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      if (creating) {
        // Create new category (service will generate slug internally)
        await budgetCategoriesService.createCategory(
          currentAccountId,
          formData.name.trim()
        )
        setSuccessMessage('Category created successfully')
      } else if (editingId) {
        // Update existing category
        await budgetCategoriesService.updateCategory(currentAccountId, editingId, {
          name: formData.name.trim()
        })
        setSuccessMessage('Category updated successfully')
      }

      // Reload categories
      await loadCategories()
      handleCancel()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving category:', err)
      setError(err instanceof Error ? err.message : 'Failed to save category')
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async (categoryId: string) => {
    if (!currentAccountId) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      await budgetCategoriesService.archiveCategory(currentAccountId, categoryId)
      setSuccessMessage('Category archived successfully')

      // Reload categories
      await loadCategories()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error archiving category:', err)
      setError(err instanceof Error ? err.message : 'Failed to archive category')
    } finally {
      setIsSaving(false)
    }
  }

  const handleUnarchive = async (categoryId: string) => {
    if (!currentAccountId) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      await budgetCategoriesService.unarchiveCategory(currentAccountId, categoryId)
      setSuccessMessage('Category unarchived successfully')

      // Reload categories
      await loadCategories()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error unarchiving category:', err)
      setError(err instanceof Error ? err.message : 'Failed to unarchive category')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleSelect = (categoryId: string) => {
    // removed bulk selection UI — no-op
  }

  const handleSelectAll = () => {
    // removed bulk selection UI — no-op
  }

  const handleBulkArchive = async () => {
    // bulk archive removed
  }

  const handleDragStart = (categoryId: string) => {
    setDraggedCategoryId(categoryId)
  }

  const handleDragOver = (e: React.DragEvent, categoryId: string) => {
    e.preventDefault()
    if (draggedCategoryId && draggedCategoryId !== categoryId) {
      setDragOverCategoryId(categoryId)
    }
  }

  const handleDragLeave = () => {
    setDragOverCategoryId(null)
  }

  const handleDrop = async (e: React.DragEvent, targetCategoryId: string) => {
    e.preventDefault()
    setDragOverCategoryId(null)

    if (!draggedCategoryId || !currentAccountId || draggedCategoryId === targetCategoryId) {
      setDraggedCategoryId(null)
      return
    }

    const activeCategories = categories.filter(c => !c.isArchived)
    const draggedIndex = activeCategories.findIndex(c => c.id === draggedCategoryId)
    const targetIndex = activeCategories.findIndex(c => c.id === targetCategoryId)

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedCategoryId(null)
      return
    }

    // Reorder categories
    const reorderedCategories = [...activeCategories]
    const [draggedCategory] = reorderedCategories.splice(draggedIndex, 1)
    reorderedCategories.splice(targetIndex, 0, draggedCategory)

    // Update local state immediately for better UX
    const archivedCategories = categories.filter(c => c.isArchived)
    setCategories([...reorderedCategories, ...archivedCategories])

    // Save order to presets
    try {
      setIsSavingOrder(true)
      const categoryIds = reorderedCategories.map(c => c.id)
      await setBudgetCategoryOrder(currentAccountId, categoryIds)
      setSuccessMessage('Category order saved')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving category order:', err)
      setError('Failed to save category order')
      // Reload categories to revert to original order
      await loadCategories()
    } finally {
      setIsSavingOrder(false)
      setDraggedCategoryId(null)
    }
  }

  const handleDragEnd = () => {
    setDraggedCategoryId(null)
    setDragOverCategoryId(null)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  const activeCategories = categories.filter(c => !c.isArchived)
  const archivedCategories = categories.filter(c => c.isArchived)

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-1">Budget Categories</h4>
        <p className="text-sm text-gray-500">
          Manage budget categories for transactions. Archive transactions to hide them from the list in forms.
        </p>
      </div>

      {/* Account-wide default category preset */}
      <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
        <p className="text-sm text-gray-500 mb-3">Set the default category that will be used when creating transactions.</p>
        <div className="flex items-start space-x-3">
          <div className="flex-1">
            <CategorySelect
              id="accountDefaultCategory"
              label="Default Transaction Category"
              value={selectedDefaultCategoryId || undefined}
              onChange={(categoryId) => setSelectedDefaultCategoryId(categoryId || null)}
              helperText="This default applies account-wide (saved locally for now)"
              asDropdown={true}
            />
          </div>
          <div className="pt-6">
            <Button
              onClick={async () => {
                if (!currentAccountId) return
                setIsSavingDefault(true)
                setDefaultSaveMessage(null)
                try {
                  await setDefaultCategory(currentAccountId, selectedDefaultCategoryId)
                  setDefaultSaveMessage('Default category saved')
                  setTimeout(() => setDefaultSaveMessage(null), 3000)
                } catch (err) {
                  console.error('Error saving default category to Postgres:', err)
                  setDefaultSaveMessage('Failed to save default')
                } finally {
                  setIsSavingDefault(false)
                }
              }}
              disabled={isSavingDefault}
            >
              {isSavingDefault ? 'Saving...' : 'Save'}
            </Button>
            {defaultSaveMessage && (
              <div className="mt-2 text-sm text-green-700">{defaultSaveMessage}</div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="text-sm text-green-800">
            {successMessage}
          </div>
        </div>
      )}

      {/* Create Form - Only show when creating, not when editing inline */}
      {creating && (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
          <h5 className="text-sm font-medium text-gray-900">
            Create New Category
          </h5>
          <div>
            <label htmlFor="category-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              id="category-name"
              value={formData.name}
              onChange={(e) => handleFormChange('name', e.target.value)}
              placeholder="e.g., Design Fee, Furnishings"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              autoFocus
            />
          </div>
          {/* slug removed from settings UI */}
          <div className="flex items-center space-x-2">
            <Button
              onClick={handleSave}
              disabled={isSaving || !formData.name.trim()}
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : creating ? 'Create' : 'Save'}
            </Button>
            <Button
              onClick={handleCancel}
              variant="secondary"
              size="sm"
              disabled={isSaving}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Create Button - simplified UI */}
      {!creating && !editingId && (
        <div className="flex items-center justify-between">
          <div />
          <Button onClick={handleStartCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        </div>
      )}

      {/* bulk operations removed */}

      {/* Categories Table */}
      <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-md">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6 w-8">
                {/* Drag handle column */}
              </th>
              <th scope="col" className="py-3.5 pl-3 pr-3 text-left text-sm font-semibold text-gray-900">
                Name
              </th>
              {/* slug and transactions columns removed */}
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {activeCategories.length === 0 && archivedCategories.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-gray-500">
                  No categories found. Create your first category to get started.
                </td>
              </tr>
            ) : activeCategories.map((category) => {
                  const isDragging = draggedCategoryId === category.id
                  const isDragOver = dragOverCategoryId === category.id
                  return (
                  <tr 
                    key={category.id} 
                    className={`
                      ${editingId === category.id ? 'bg-gray-50' : ''}
                      ${isDragging ? 'opacity-50' : ''}
                      ${isDragOver ? 'bg-primary-50 border-t-2 border-primary-500' : ''}
                      transition-colors
                    `}
                    draggable={!editingId && !isSavingOrder}
                    onDragStart={() => handleDragStart(category.id)}
                    onDragOver={(e) => handleDragOver(e, category.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, category.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-gray-500 sm:pl-6">
                      {!editingId && (
                        <div
                          className="cursor-move hover:text-gray-700"
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-5 w-5" />
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-4 pl-3 pr-3 text-sm font-medium text-gray-900">
                      {editingId === category.id ? (
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => handleFormChange('name', e.target.value)}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                          autoFocus
                        />
                      ) : (
                        category.name
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {editingId === category.id ? (
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || !formData.name.trim()}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Save className="h-3 w-3 mr-1" />
                            {isSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancel}
                            disabled={isSaving}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(category)}
                            disabled={isSaving}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Edit2 className="h-3 w-3 mr-1" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchive(category.id)}
                            disabled={isSaving}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Archive className="h-3 w-3 mr-1" />
                            Archive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )})
            }
            {archivedCategories.length > 0 && (
              <>
                <tr>
                  <td colSpan={3} className="py-2 bg-gray-100">
                    <div className="flex items-center justify-between px-4">
                      <span className="text-sm font-medium text-gray-700">Archived Categories</span>
                      <button
                        type="button"
                        onClick={() => setShowArchived(!showArchived)}
                        className="text-sm text-primary-600 hover:text-primary-700"
                      >
                        {showArchived ? 'Hide' : 'Show'} Archived
                      </button>
                    </div>
                  </td>
                </tr>
                {showArchived &&
                  archivedCategories.map((category) => (
                    <tr key={category.id} className="bg-gray-50">
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-gray-500 sm:pl-6">
                        {/* Empty cell for drag handle column */}
                      </td>
                      <td className="whitespace-nowrap py-4 pl-3 pr-3 text-sm font-medium text-gray-500">
                        {category.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        <button
                          type="button"
                          onClick={() => handleUnarchive(category.id)}
                          disabled={isSaving}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ArchiveRestore className="h-3 w-3 mr-1" />
                          Unarchive
                        </button>
                      </td>
                    </tr>
                  ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

