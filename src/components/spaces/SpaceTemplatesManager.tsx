import { useState, useEffect, useCallback } from 'react'
import { Save, AlertCircle, Plus, Edit2, Archive, ArchiveRestore, X, MoreVertical } from 'lucide-react'
import { spaceTemplatesService } from '@/services/spaceTemplatesService'
import { SpaceTemplate } from '@/types'
import { useAccount } from '@/contexts/AccountContext'
import { Button } from '../ui/Button'
import { presetsActionMenuStyles, presetsTableStyles } from '@/components/presets/presetTableStyles'

export default function SpaceTemplatesManager() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [templates, setTemplates] = useState<SpaceTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [formData, setFormData] = useState({ name: '', notes: '' })
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    if (!currentAccountId) return

    try {
      setIsLoading(true)
      setError(null)
      const loadedTemplates = await spaceTemplatesService.listTemplates({
        accountId: currentAccountId,
        includeArchived: showArchived,
      })
      setTemplates(loadedTemplates)
    } catch (err) {
      console.error('Error loading space templates:', err)
      setError('Failed to load space templates')
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
      loadTemplates()
    } else {
      // If no account ID after loading completes, stop loading
      setIsLoading(false)
      setError('No account found. Please ensure you are logged in and have an account.')
    }
  }, [currentAccountId, accountLoading, loadTemplates])

  useEffect(() => {
    if (!openMenuId) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.template-actions-menu')) {
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
    setFormData({ name: '', notes: '' })
    setError(null)
    setSuccessMessage(null)
  }

  const handleStartEdit = (template: SpaceTemplate) => {
    setEditingId(template.id)
    setCreating(false)
    setFormData({ name: template.name, notes: template.notes || '' })
    setError(null)
    setSuccessMessage(null)
    setOpenMenuId(null)
  }

  const handleCancel = () => {
    setCreating(false)
    setEditingId(null)
    setFormData({ name: '', notes: '' })
    setOpenMenuId(null)
  }

  const handleFormChange = (field: 'name' | 'notes', value: string) => {
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
      setError('Template name is required')
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)
      setOpenMenuId(null)

      if (creating) {
        await spaceTemplatesService.createTemplate({
          accountId: currentAccountId,
          name: formData.name.trim(),
          notes: formData.notes.trim() || null,
        })
        setSuccessMessage('Template created successfully')
      } else if (editingId) {
        await spaceTemplatesService.updateTemplate(currentAccountId, editingId, {
          name: formData.name.trim(),
          notes: formData.notes.trim() || null,
        })
        setSuccessMessage('Template updated successfully')
      }

      // Reload templates
      await loadTemplates()
      handleCancel()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving template:', err)
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async (templateId: string) => {
    if (!currentAccountId) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      await spaceTemplatesService.archiveTemplate(currentAccountId, templateId)
      setSuccessMessage('Template archived successfully')

      // Reload templates
      await loadTemplates()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error archiving template:', err)
      setError(err instanceof Error ? err.message : 'Failed to archive template')
    } finally {
      setIsSaving(false)
    }
  }

  const handleUnarchive = async (templateId: string) => {
    if (!currentAccountId) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      await spaceTemplatesService.unarchiveTemplate(currentAccountId, templateId)
      setSuccessMessage('Template unarchived successfully')

      // Reload templates
      await loadTemplates()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error unarchiving template:', err)
      setError(err instanceof Error ? err.message : 'Failed to unarchive template')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  const activeTemplates = templates.filter(t => !t.isArchived)
  const archivedTemplates = templates.filter(t => t.isArchived)

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-1">Space Templates</h4>
        <p className="text-sm text-gray-500">
          Create reusable space templates that can be used when creating new spaces in projects. Archive templates to hide them from the picker.
        </p>
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

      {/* Create Form */}
      {creating && (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
          <h5 className="text-sm font-medium text-gray-900">
            Create New Template
          </h5>
          <div>
            <label htmlFor="template-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              id="template-name"
              value={formData.name}
              onChange={(e) => handleFormChange('name', e.target.value)}
              placeholder="e.g., Living Room, Kitchen, Storage Unit"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="template-notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              id="template-notes"
              value={formData.notes}
              onChange={(e) => handleFormChange('notes', e.target.value)}
              placeholder="Add any notes about this template..."
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              rows={3}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Button
              onClick={handleSave}
              disabled={isSaving || !formData.name.trim()}
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Create'}
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

      {/* Create Button */}
      {!creating && !editingId && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            {showArchived ? 'Hide' : 'Show'} Archived
          </button>
          <Button onClick={handleStartCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>
      )}

      {/* Templates Table */}
      <div className={presetsTableStyles.wrapper}>
        <table className={presetsTableStyles.table}>
          <thead className={presetsTableStyles.headerRow}>
            <tr>
              <th scope="col" className={presetsTableStyles.headerCell}>
                Name
              </th>
              <th scope="col" className={presetsTableStyles.headerCellCompact}>
                Notes
              </th>
              <th scope="col" className={presetsTableStyles.headerCellCompact}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className={presetsTableStyles.body}>
            {activeTemplates.length === 0 && archivedTemplates.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-gray-500">
                  No templates found. Create your first template to get started.
                </td>
              </tr>
            ) : activeTemplates.map((template) => {
                return (
                  <tr 
                    key={template.id} 
                    className={editingId === template.id ? 'bg-gray-50' : ''}
                  >
                    <td className="py-2 pl-3 pr-2 font-medium text-gray-900 sm:pl-4">
                      {editingId === template.id ? (
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => handleFormChange('name', e.target.value)}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="block max-w-[10rem] truncate">
                          {template.name}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-gray-500">
                      {editingId === template.id ? (
                        <textarea
                          value={formData.notes}
                          onChange={(e) => handleFormChange('notes', e.target.value)}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                          rows={2}
                        />
                      ) : (
                        <span className="block max-w-[20rem] truncate">
                          {template.notes || <span className="text-gray-400 italic">No notes</span>}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                      {editingId === template.id ? (
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
                        <div className={`${presetsActionMenuStyles.wrapper} template-actions-menu`}>
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(prev => (prev === template.id ? null : template.id))}
                            disabled={isSaving}
                            className={presetsActionMenuStyles.button}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === template.id}
                          >
                            <span className="sr-only">Open actions</span>
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                          {openMenuId === template.id && (
                            <div
                              className={presetsActionMenuStyles.panel}
                              role="menu"
                            >
                              <button
                                type="button"
                                onClick={() => handleStartEdit(template)}
                                className={presetsActionMenuStyles.item}
                                role="menuitem"
                              >
                                <Edit2 className="h-3.5 w-3.5 mr-2 text-gray-500" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleArchive(template.id)}
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
            {showArchived && (
              <>
                <tr>
                  <td colSpan={3} className="py-2 bg-gray-100">
                    <div className="flex items-center justify-between px-4">
                      <span className="text-sm font-medium text-gray-700">Archived Templates</span>
                    </div>
                  </td>
                </tr>
                {archivedTemplates.length > 0 ? (
                  archivedTemplates.map((template) => (
                    <tr key={template.id} className="bg-gray-50">
                      <td className="py-2 pl-3 pr-2 font-medium text-gray-500 sm:pl-4">
                        <span className="block max-w-[10rem] truncate">
                          {template.name}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-gray-500">
                        <span className="block max-w-[20rem] truncate">
                          {template.notes || <span className="text-gray-400 italic">No notes</span>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                        <button
                          type="button"
                          onClick={() => handleUnarchive(template.id)}
                          disabled={isSaving}
                          className="inline-flex items-center px-2 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ArchiveRestore className="h-3 w-3 mr-1" />
                          Unarchive
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-gray-500">
                      No archived templates.
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
