import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Save, AlertCircle, Plus, Edit2, Archive, ArchiveRestore, X, Trash2, GripVertical, Info, MoreVertical } from 'lucide-react'
import { budgetCategoriesService } from '@/services/budgetCategoriesService'
import { getDefaultCategory, setDefaultCategory, setBudgetCategoryOrder } from '@/services/accountPresetsService'
import { BudgetCategory } from '@/types'
import { useAccount } from '@/contexts/AccountContext'
import { Button } from './ui/Button'
import { presetsActionMenuStyles, presetsTableStyles } from '@/components/presets/presetTableStyles'
import CategorySelect from '@/components/CategorySelect'
import { getItemizationEnabled } from '@/utils/categoryItemization'

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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [hasArchivedCategories, setHasArchivedCategories] = useState(false)

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
      setHasArchivedCategories(prevHasArchived =>
        showArchived ? loadedCategories.some(category => category.isArchived) : prevHasArchived
      )
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

  useEffect(() => {
    if (!creating) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [creating])

  useEffect(() => {
    if (!openMenuId) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.category-actions-menu')) {
        setOpenMenuId(null)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuId(null)
      }
    }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuId])

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
    setOpenMenuId(null)
  }

  const handleToggleItemization = async (categoryId: string, currentValue: boolean) => {
    if (!currentAccountId) return

    const category = categories.find(c => c.id === categoryId)
    if (!category) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)
      setOpenMenuId(null)

      const currentMetadata = category.metadata || {}
      const newMetadata = {
        ...currentMetadata,
        itemizationEnabled: !currentValue
      }

      await budgetCategoriesService.updateCategory(currentAccountId, categoryId, {
        metadata: newMetadata
      })
      setSuccessMessage('Itemization setting updated')

      // Reload categories
      await loadCategories()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error updating itemization setting:', err)
      setError(err instanceof Error ? err.message : 'Failed to update itemization setting')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setCreating(false)
    setEditingId(null)
    setFormData({ name: '' })
    setOpenMenuId(null)
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
      setOpenMenuId(null)

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
      setHasArchivedCategories(true)
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
  const showArchivedSection = hasArchivedCategories || archivedCategories.length > 0

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-1">Budget Categories</h4>
        <p className="text-sm text-gray-500">
          Manage budget categories for transactions. Archive transactions to hide them from the list in forms.
        </p>
      </div>

      {/* Account-wide default category preset */}
      <div className="bg-gray-50 border border-gray-200 rounded-md p-4 max-w-4xl">
        <p className="text-sm text-gray-500 mb-3">Set the default category that will be used when creating transactions.</p>
        <div className="flex items-start space-x-3">
          <div className="w-full max-w-xs">
            <CategorySelect
              id="accountDefaultCategory"
              label="Default Transaction Category"
              value={selectedDefaultCategoryId || undefined}
              onChange={(categoryId) => setSelectedDefaultCategoryId(categoryId || null)}
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


      {/* bulk operations removed */}

      {/* Categories Table */}
      <div className={presetsTableStyles.wrapper}>
        {showArchivedSection && (
          <div className="flex justify-end px-4 py-2 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              {showArchived ? 'Hide' : 'Show'} Archived
            </button>
          </div>
        )}
        <div className={presetsTableStyles.scrollArea}>
          <table className={presetsTableStyles.table}>
            <tbody className={presetsTableStyles.body}>
            {activeCategories.length > 0 || creating ? (
              <tr>
                <td className="py-2 bg-gray-100 pl-3 pr-2 sm:pl-4">
                  {/* Empty cell for drag handle column */}
                </td>
                <td className="py-2 bg-gray-100 pl-2 pr-2">
                  <span className="text-sm font-medium text-gray-700">Active Categories</span>
                </td>
                <td className="py-2 bg-gray-100 px-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Itemize</span>
                </td>
                <td className="py-2 bg-gray-100 px-2">
                  {/* Empty cell for actions column */}
                </td>
              </tr>
            ) : null}

            {/* Empty state or categories */}
            {activeCategories.length === 0 && archivedCategories.length === 0 && !creating ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-gray-500">
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
                    <td className="whitespace-nowrap py-2 pl-3 pr-2 text-gray-500 sm:pl-4">
                      {!editingId && (
                        <div
                          className="cursor-move hover:text-gray-700"
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-4 w-4" />
                        </div>
                      )}
                    </td>
                    <td className="py-2 pl-2 pr-2 font-medium text-gray-900">
                      {editingId === category.id ? (
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => handleFormChange('name', e.target.value)}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="block max-w-[10rem] truncate">
                          {category.name}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                      {editingId !== category.id && (
                        <div className="flex items-center space-x-1">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={getItemizationEnabled(category)}
                              onChange={() => handleToggleItemization(category.id, getItemizationEnabled(category))}
                              disabled={isSaving}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                          </label>
                          <div className="group relative">
                            <Info className="h-3.5 w-3.5 text-gray-400 cursor-help" />
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              When enabled, transactions in this category can have line items attached. When disabled, the items section and audit/review features are hidden for transactions in this category.
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                      {editingId === category.id ? (
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || !formData.name.trim()}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Save className="h-3 w-3 mr-1" />
                            {isSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancel}
                            disabled={isSaving}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className={`${presetsActionMenuStyles.wrapper} category-actions-menu`}>
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(prev => (prev === category.id ? null : category.id))}
                            disabled={isSaving}
                            className={presetsActionMenuStyles.button}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === category.id}
                          >
                            <span className="sr-only">Open actions</span>
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                          {openMenuId === category.id && (
                            <div
                              className={presetsActionMenuStyles.panel}
                              role="menu"
                            >
                              <button
                                type="button"
                                onClick={() => handleStartEdit(category)}
                                className={presetsActionMenuStyles.item}
                                role="menuitem"
                              >
                                <Edit2 className="h-3.5 w-3.5 mr-2 text-gray-500" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleArchive(category.id)}
                                className={presetsActionMenuStyles.item}
                                role="menuitem"
                              >
                                <Archive className="h-3.5 w-3.5 mr-2 text-gray-500" />
                                Archive
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )})
            }
            
            {/* Add new category row (when not creating) */}
            {!creating && !editingId && (
              <tr 
                className="bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                onClick={handleStartCreate}
              >
                <td className="whitespace-nowrap py-2 pl-3 pr-2 text-gray-400 sm:pl-4">
                  {/* Empty drag handle cell */}
                </td>
                <td className="whitespace-nowrap py-2 pl-2 pr-2 text-gray-400">
                  <div className="flex items-center">
                    <Plus className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span className="text-sm italic whitespace-nowrap">Click to create new category</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-gray-400">
                  <span className="text-sm italic">-</span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-gray-400">
                  {/* Empty actions cell */}
                </td>
              </tr>
            )}
            
            {showArchivedSection && (
              <>
                {(activeCategories.length > 0 || creating) && (
                  <tr>
                    <td colSpan={4} className="py-2">
                      <div className="h-2" />
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="py-2 bg-gray-100 pl-3 pr-2 sm:pl-4">
                    {/* Empty cell for drag handle column */}
                  </td>
                  <td className="py-2 bg-gray-100 pl-2 pr-2">
                    <span className="text-sm font-medium text-gray-700">Archived Categories</span>
                  </td>
                  <td className="py-2 bg-gray-100 px-2">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Itemize</span>
                  </td>
                  <td className="py-2 bg-gray-100 px-2">
                    {/* Empty cell for actions column */}
                  </td>
                </tr>
                {showArchived &&
                  archivedCategories.map((category) => (
                    <tr 
                      key={category.id} 
                      className={`bg-gray-50 ${editingId === category.id ? 'bg-gray-100' : ''}`}
                    >
                    <td className="whitespace-nowrap py-2 pl-3 pr-2 text-gray-500 sm:pl-4">
                        {/* Empty cell for drag handle column */}
                      </td>
                      <td className="py-2 pl-2 pr-2 font-medium text-gray-500">
                        {editingId === category.id ? (
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => handleFormChange('name', e.target.value)}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                            autoFocus
                          />
                        ) : (
                          <span className="block max-w-[10rem] truncate">
                            {category.name}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                        {editingId !== category.id && (
                          <div className="flex items-center space-x-1">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={getItemizationEnabled(category)}
                                onChange={() => handleToggleItemization(category.id, getItemizationEnabled(category))}
                                disabled={isSaving}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                            </label>
                            <div className="group relative">
                              <Info className="h-3.5 w-3.5 text-gray-400 cursor-help" />
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                When enabled, transactions in this category can have line items attached. When disabled, the items section and audit/review features are hidden for transactions in this category.
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                        {editingId === category.id ? (
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={handleSave}
                              disabled={isSaving || !formData.name.trim()}
                              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Save className="h-3 w-3 mr-1" />
                              {isSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={handleCancel}
                              disabled={isSaving}
                              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className={`${presetsActionMenuStyles.wrapper} category-actions-menu`}>
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(prev => (prev === category.id ? null : category.id))}
                              disabled={isSaving}
                              className={presetsActionMenuStyles.button}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === category.id}
                            >
                              <span className="sr-only">Open actions</span>
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                            {openMenuId === category.id && (
                              <div
                                className={presetsActionMenuStyles.panel}
                                role="menu"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(category)}
                                  className={presetsActionMenuStyles.item}
                                  role="menuitem"
                                >
                                  <Edit2 className="h-3.5 w-3.5 mr-2 text-gray-500" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUnarchive(category.id)}
                                  className={presetsActionMenuStyles.item}
                                  role="menuitem"
                                >
                                  <ArchiveRestore className="h-3.5 w-3.5 mr-2 text-gray-500" />
                                  Unarchive
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </>
            )}
            </tbody>
          </table>
        </div>
      </div>

      {creating &&
        createPortal(
          <div
            className="fixed left-0 top-0 z-50 flex h-[100dvh] w-screen items-start justify-center bg-gray-900/40 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label="Create budget category"
            onClick={handleCancel}
          >
            <div
              className="w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl space-y-6 rounded-lg bg-white shadow-xl mx-auto max-h-[calc(100dvh-2rem)] overflow-y-auto"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Create budget category</h3>
                  <p className="mt-1 text-sm text-gray-500">Add a name for this category.</p>
                </div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-md p-2 text-gray-500 hover:text-gray-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-6 pb-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="budget-category-name">
                    Category Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="budget-category-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    placeholder="Category name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving || !formData.name.trim()}
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Saving...' : 'Create category'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

