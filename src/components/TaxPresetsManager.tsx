import { useState, useEffect, useCallback } from 'react'
import { Save, AlertCircle, GripVertical, MoreVertical, Edit2, Trash2, X } from 'lucide-react'
import { getTaxPresets, updateTaxPresets } from '@/services/taxPresetsService'
import { TaxPreset } from '@/types'
import { useAccount } from '@/contexts/AccountContext'
import { presetsTableStyles, presetsActionMenuStyles } from '@/components/presets/presetTableStyles'

export default function TaxPresetsManager() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [presets, setPresets] = useState<TaxPreset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<{ name: string; rate: number } | null>(null)
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null)
  const [draggedPresetId, setDraggedPresetId] = useState<string | null>(null)
  const [dragOverPresetId, setDragOverPresetId] = useState<string | null>(null)

  const loadPresets = useCallback(async () => {
    if (!currentAccountId) return
    
    try {
      setIsLoading(true)
      setError(null)
      const loadedPresets = await getTaxPresets(currentAccountId)
      setPresets(loadedPresets)
    } catch (err) {
      console.error('Error loading tax presets:', err)
      setError('Failed to load tax presets')
    } finally {
      setIsLoading(false)
    }
  }, [currentAccountId])

  useEffect(() => {
    // Wait for account to finish loading
    if (accountLoading) {
      return
    }

    if (currentAccountId) {
      loadPresets()
    } else {
      // If no account ID after loading completes, stop loading
      setIsLoading(false)
      setError('No account found. Please ensure you are logged in and have an account.')
    }
  }, [currentAccountId, accountLoading, loadPresets])

  useEffect(() => {
    if (openMenuIndex === null) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.tax-presets-actions-menu')) {
        setOpenMenuIndex(null)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuIndex(null)
      }
    }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuIndex])

  const handlePresetChange = (index: number, field: 'name' | 'rate', value: string | number) => {
    setPresets(prev => prev.map((preset, i) => {
      if (i === index) {
        return { ...preset, [field]: value }
      }
      return preset
    }))
    // Clear messages when user makes changes
    setError(null)
    setSuccessMessage(null)
  }

  const handleStartEdit = (index: number) => {
    const preset = presets[index]
    setEditingIndex(index)
    setEditingValue({ name: preset.name, rate: preset.rate })
    setOpenMenuIndex(null)
  }

  const handleCancelEdit = () => {
    setEditingIndex(null)
    setEditingValue(null)
    loadPresets() // Reset to original values
  }

  const handleSaveEdit = async (index: number) => {
    if (!currentAccountId || !editingValue) return

    if (!editingValue.name.trim()) {
      setError('Preset name is required')
      return
    }
    if (editingValue.rate < 0 || editingValue.rate > 100) {
      setError('Tax rates must be between 0 and 100')
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      const updatedPresets = [...presets]
      updatedPresets[index] = {
        ...updatedPresets[index],
        name: editingValue.name.trim(),
        rate: editingValue.rate
      }

      await updateTaxPresets(currentAccountId, updatedPresets)
      setPresets(updatedPresets)
      setSuccessMessage('Tax preset updated successfully')
      setEditingIndex(null)
      setEditingValue(null)
      
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving tax preset:', err)
      setError(err instanceof Error ? err.message : 'Failed to save tax preset')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (index: number) => {
    if (!currentAccountId) return
    if (presets.length <= 1) {
      setError('At least one tax preset is required')
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)
      setOpenMenuIndex(null)

      const updatedPresets = presets.filter((_, i) => i !== index)

      await updateTaxPresets(currentAccountId, updatedPresets)
      setPresets(updatedPresets)
      setSuccessMessage('Tax preset deleted successfully')
      
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error deleting tax preset:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete tax preset')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDragStart = (presetId: string) => {
    setDraggedPresetId(presetId)
  }

  const handleDragOver = (e: React.DragEvent, presetId: string) => {
    e.preventDefault()
    if (draggedPresetId && draggedPresetId !== presetId) {
      setDragOverPresetId(presetId)
    }
  }

  const handleDragLeave = () => {
    setDragOverPresetId(null)
  }

  const handleDrop = async (e: React.DragEvent, targetPresetId: string) => {
    e.preventDefault()
    setDragOverPresetId(null)

    if (!draggedPresetId || !currentAccountId || draggedPresetId === targetPresetId) {
      setDraggedPresetId(null)
      return
    }

    const draggedIndex = presets.findIndex(p => p.id === draggedPresetId)
    const targetIndex = presets.findIndex(p => p.id === targetPresetId)

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedPresetId(null)
      return
    }

    // Reorder presets
    const reorderedPresets = [...presets]
    const [draggedPreset] = reorderedPresets.splice(draggedIndex, 1)
    reorderedPresets.splice(targetIndex, 0, draggedPreset)

    // Update local state immediately
    setPresets(reorderedPresets)

    // Save order
    try {
      setIsSaving(true)
      await updateTaxPresets(currentAccountId, reorderedPresets)
      setSuccessMessage('Preset order saved')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving preset order:', err)
      setError('Failed to save preset order')
      await loadPresets() // Reload to revert
    } finally {
      setIsSaving(false)
      setDraggedPresetId(null)
    }
  }

  const handleDragEnd = () => {
    setDraggedPresetId(null)
    setDragOverPresetId(null)
  }

  const handleSave = async () => {
    if (!currentAccountId) {
      setError('Account ID is required to save tax presets')
      return
    }
    
    try {
      setIsSaving(true)
      setError(null)
      setSuccessMessage(null)

      // Validate presets
      for (const preset of presets) {
        if (!preset.name.trim()) {
          throw new Error('All presets must have a name')
        }
        if (preset.rate < 0 || preset.rate > 100) {
          throw new Error('Tax rates must be between 0 and 100')
        }
      }

      await updateTaxPresets(currentAccountId, presets)
      setSuccessMessage('Tax presets updated successfully')
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving tax presets:', err)
      setError(err instanceof Error ? err.message : 'Failed to save tax presets')
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

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-medium text-gray-900 mb-1">Tax Rate Presets</h4>
        <p className="text-sm text-gray-500">
          Manage the 5 tax rate presets available when creating transactions. These presets can be selected to auto-populate the tax rate.
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

      <div className={presetsTableStyles.wrapper}>
        <div className={presetsTableStyles.scrollArea}>
          <table className={presetsTableStyles.table}>
            <tbody className={presetsTableStyles.body}>
            {presets.map((preset, index) => {
              const isDragging = draggedPresetId === preset.id
              const isDragOver = dragOverPresetId === preset.id
              const isEditing = editingIndex === index
              
              return (
                <tr 
                  key={preset.id}
                  className={`
                    ${isDragging ? 'opacity-50' : ''}
                    ${isDragOver ? 'bg-primary-50 border-t-2 border-primary-500' : ''}
                    transition-colors
                  `}
                  draggable={!isEditing && !isSaving}
                  onDragStart={() => handleDragStart(preset.id)}
                  onDragOver={(e) => handleDragOver(e, preset.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, preset.id)}
                  onDragEnd={handleDragEnd}
                >
                  <td className="whitespace-nowrap py-2 pl-3 pr-2 text-gray-500 sm:pl-4">
                    {!isEditing && (
                      <div
                        className="cursor-move hover:text-gray-700"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-2 pr-2 text-sm sm:pl-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingValue?.name || ''}
                        onChange={(e) => setEditingValue(prev => prev ? { ...prev, name: e.target.value } : null)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                        placeholder="Preset name"
                        autoFocus
                      />
                    ) : (
                      <span className="block max-w-[10rem] truncate text-gray-900">
                        {preset.name || <span className="text-gray-400 italic">Unnamed</span>}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-sm text-gray-500">
                    {isEditing ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        value={editingValue?.rate ?? 0}
                        onChange={(e) => setEditingValue(prev => prev ? { ...prev, rate: parseFloat(e.target.value) || 0 } : null)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                        placeholder="0.00"
                      />
                    ) : (
                      <span className="text-gray-900">
                        {preset.rate}%
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                    {isEditing ? (
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(index)}
                          disabled={isSaving || !editingValue?.name.trim()}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Save className="h-3 w-3 mr-1" />
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className={`${presetsActionMenuStyles.wrapper} tax-presets-actions-menu`}>
                        <button
                          type="button"
                          onClick={() => setOpenMenuIndex(prev => (prev === index ? null : index))}
                          disabled={isSaving}
                          className={presetsActionMenuStyles.button}
                          aria-haspopup="menu"
                          aria-expanded={openMenuIndex === index}
                        >
                          <span className="sr-only">Open actions</span>
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                        {openMenuIndex === index && (
                          <div className={presetsActionMenuStyles.panel} role="menu">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(index)}
                              className={presetsActionMenuStyles.item}
                              role="menuitem"
                            >
                              <Edit2 className="h-3.5 w-3.5 mr-2 text-gray-500" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(index)}
                              className={presetsActionMenuStyles.item}
                              role="menuitem"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2 text-gray-500" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

