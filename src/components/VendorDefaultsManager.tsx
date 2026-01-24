import { useState, useEffect, useCallback } from 'react'
import { Save, AlertCircle, X, MoreVertical, Edit2, Trash2 } from 'lucide-react'
import { getVendorDefaults, updateVendorSlot, VendorSlot } from '@/services/vendorDefaultsService'
import { useAccount } from '@/contexts/AccountContext'
import { useAuth } from '@/contexts/AuthContext'
import { presetsActionMenuStyles, presetsTableStyles } from '@/components/presets/presetTableStyles'

export default function VendorDefaultsManager() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const { user } = useAuth()
  const [slots, setSlots] = useState<VendorSlot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [savingSlotIndex, setSavingSlotIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<string>('')
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null)

  const loadDefaults = useCallback(async () => {
    if (!currentAccountId) return
    
    try {
      setIsLoading(true)
      setError(null)
      const response = await getVendorDefaults(currentAccountId)
      setSlots(response.slots)
    } catch (err) {
      console.error('Error loading vendor defaults:', err)
      setError('Failed to load vendor defaults')
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
      loadDefaults()
    } else {
      // If no account ID after loading completes, stop loading
      setIsLoading(false)
      setError('No account found. Please ensure you are logged in and have an account.')
    }
  }, [currentAccountId, accountLoading, loadDefaults])

  useEffect(() => {
    if (openMenuIndex === null) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.vendor-defaults-actions-menu')) {
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

  const handleSlotChange = (slotIndex: number, vendorId: string | null) => {
    // kept for backwards-compatibility; prefer using inline editing + save
    setSlots(prev => prev.map((slot, index) => {
      if (index === slotIndex) {
        return vendorId ? { id: vendorId, name: vendorId } : { id: null, name: null }
      }
      return slot
    }))
    setEditingSlotIndex(null)
    setEditingValue('')
  }

  const handleSaveSlot = async (slotIndex: number) => {
    if (!currentAccountId) {
      setError('Account ID is required to save vendor defaults')
      return
    }

    // Use the freeform editing value as the vendor identifier/name.
    const vendorId = editingValue?.trim() ? editingValue.trim() : null

    try {
      setSavingSlotIndex(slotIndex)
      setError(null)
      setSuccessMessage(null)

      await updateVendorSlot(
        currentAccountId,
        slotIndex + 1, // Convert 0-based to 1-based
        vendorId,
        user?.id
      )
      
      // Update local state to reflect the saved value
      setSlots(prev => prev.map((s, idx) => {
        if (idx === slotIndex) {
          return vendorId ? { id: vendorId, name: vendorId } : { id: null, name: null }
        }
        return s
      }))
      setSuccessMessage(`Slot ${slotIndex + 1} updated successfully`)
      setEditingSlotIndex(null)
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error saving vendor slot:', err)
      setError(err instanceof Error ? err.message : 'Failed to save vendor slot')
    } finally {
      setSavingSlotIndex(null)
    }
  }

  const handleStartEdit = (slotIndex: number, slotName: string | null) => {
    setEditingSlotIndex(slotIndex)
    setEditingValue(slotName || '')
    setOpenMenuIndex(null)
  }

  const handleDeleteSlot = async (slotIndex: number) => {
    if (!currentAccountId) {
      setError('Account ID is required to delete vendor defaults')
      return
    }

    try {
      setSavingSlotIndex(slotIndex)
      setError(null)
      setSuccessMessage(null)
      setOpenMenuIndex(null)

      await updateVendorSlot(
        currentAccountId,
        slotIndex + 1,
        null,
        user?.id
      )

      setSlots(prev => prev.map((slot, idx) => {
        if (idx === slotIndex) {
          return { id: null, name: null }
        }
        return slot
      }))
      setSuccessMessage(`Slot ${slotIndex + 1} cleared`)
      setEditingSlotIndex(null)
      setEditingValue('')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error deleting vendor slot:', err)
      setError(err instanceof Error ? err.message : 'Failed to clear vendor slot')
    } finally {
      setSavingSlotIndex(null)
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
        <h4 className="text-lg font-medium text-gray-900 mb-1">Transaction Vendor Defaults</h4>
        <p className="text-sm text-gray-500">
          Set your top 10 vendors/sources for transaction forms. Each slot can be individually edited and saved.
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
        <table className={presetsTableStyles.table}>
          <thead className={presetsTableStyles.headerRow}>
            <tr>
              <th scope="col" className={presetsTableStyles.headerCell}>
                Slot
              </th>
              <th scope="col" className={presetsTableStyles.headerCellCompact}>
                Vendor/Source
              </th>
              <th scope="col" className={presetsTableStyles.headerCellCompact}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className={presetsTableStyles.body}>
            {slots.map((slot, index) => (
              <tr key={index}>
                <td className="whitespace-nowrap py-2 pl-3 pr-2 text-sm font-medium text-gray-900 sm:pl-4">
                  {index + 1}
                </td>
                <td className="px-2 py-2 text-sm text-gray-500">
                  {editingSlotIndex === index ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        placeholder="Enter vendor/source name (any text allowed)"
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <span className={slot.name ? 'text-gray-900' : 'text-gray-400 italic'}>
                        {slot.name || 'Empty'}
                      </span>
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-sm text-gray-500">
                  {editingSlotIndex === index ? (
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleSaveSlot(index)}
                        disabled={savingSlotIndex === index}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save className="h-3 w-3 mr-1" />
                        {savingSlotIndex === index ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSlotIndex(null)
                          setEditingValue('')
                          loadDefaults() // Reset to original values
                        }}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className={`${presetsActionMenuStyles.wrapper} vendor-defaults-actions-menu`}>
                      <button
                        type="button"
                        onClick={() => setOpenMenuIndex(prev => (prev === index ? null : index))}
                        disabled={savingSlotIndex === index}
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
                            onClick={() => handleStartEdit(index, slot?.name || null)}
                            className={presetsActionMenuStyles.item}
                            role="menuitem"
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-2 text-gray-500" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSlot(index)}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

