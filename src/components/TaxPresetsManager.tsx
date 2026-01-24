import { useState, useEffect, useCallback } from 'react'
import { Save, AlertCircle } from 'lucide-react'
import { getTaxPresets, updateTaxPresets } from '@/services/taxPresetsService'
import { TaxPreset } from '@/types'
import { useAccount } from '@/contexts/AccountContext'
import { presetsTableStyles } from '@/components/presets/presetTableStyles'

export default function TaxPresetsManager() {
  const { currentAccountId, loading: accountLoading } = useAccount()
  const [presets, setPresets] = useState<TaxPreset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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
        <table className={presetsTableStyles.table}>
          <thead className={presetsTableStyles.headerRow}>
            <tr>
              <th scope="col" className={presetsTableStyles.headerCell}>
                Preset Name
              </th>
              <th scope="col" className={presetsTableStyles.headerCellCompact}>
                Tax Rate (%)
              </th>
            </tr>
          </thead>
          <tbody className={presetsTableStyles.body}>
            {presets.map((preset, index) => (
              <tr key={preset.id}>
                <td className="whitespace-nowrap py-2 pl-3 pr-2 text-sm sm:pl-4">
                  <input
                    type="text"
                    value={preset.name}
                    onChange={(e) => handlePresetChange(index, 'name', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                    placeholder="Preset name"
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-sm text-gray-500">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={preset.rate}
                    onChange={(e) => handlePresetChange(index, 'rate', parseFloat(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                    placeholder="0.00"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="h-3 w-3 mr-1" />
          {isSaving ? 'Saving...' : 'Save Presets'}
        </button>
      </div>
    </div>
  )
}

