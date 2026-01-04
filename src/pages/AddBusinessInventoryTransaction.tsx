import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { ArrowLeft, X, Save } from 'lucide-react'
import { Transaction, Project, TaxPreset } from '@/types'
import { CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { transactionService, projectService } from '@/services/inventoryService'
import { getTaxPresets } from '@/services/taxPresetsService'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import { useAccount } from '@/contexts/AccountContext'
import { useAuth } from '@/contexts/AuthContext'
import CategorySelect from '@/components/CategorySelect'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'

export default function AddBusinessInventoryTransaction() {
  const navigate = useStackedNavigate()
  const hasSyncError = useSyncError()
  const location = useLocation()
  const { currentAccountId } = useAccount()
  const { user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [formData, setFormData] = useState({
    projectId: '',
    transactionDate: (() => {
      const today = new Date()
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    })(),
    source: '',
    transactionType: 'Purchase',
    paymentMethod: '',
    amount: '',
    categoryId: '',
    notes: '',
    status: 'pending' as const,
    reimbursementType: '' as '' | typeof CLIENT_OWES_COMPANY | typeof COMPANY_OWES_CLIENT | null | undefined,
    triggerEvent: 'Manual' as const,
    receiptEmailed: false
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isCustomSource, setIsCustomSource] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])

  // Tax form state
  const [taxRatePreset, setTaxRatePreset] = useState<string | undefined>(undefined)
  const [subtotal, setSubtotal] = useState<string>('')
  const [taxPresets, setTaxPresets] = useState<TaxPreset[]>([])
  const [selectedPresetRate, setSelectedPresetRate] = useState<number | undefined>(undefined)

  // Initialize custom source state based on initial form data
  useEffect(() => {
    if (formData.source && !availableVendors.includes(formData.source)) {
      setIsCustomSource(true)
    } else if (formData.source && availableVendors.includes(formData.source)) {
      setIsCustomSource(false)
    }
  }, [formData.source, availableVendors])

  // Load vendor defaults on mount
  useEffect(() => {
    const loadVendors = async () => {
      if (!currentAccountId) return
      try {
        const vendors = await getAvailableVendors(currentAccountId)
        setAvailableVendors(vendors)
      } catch (error) {
        console.error('Error loading vendor defaults:', error)
        setAvailableVendors([])
      }
    }
    loadVendors()
  }, [currentAccountId])

  // Navigation context logic
  const backDestination = useMemo(() => {
    // Check if we have a returnTo parameter
    const searchParams = new URLSearchParams(location.search)
    const returnTo = searchParams.get('returnTo')
    if (returnTo) return returnTo

    // Default fallback
    return '/business-inventory'
  }, [location.search])

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      if (!currentAccountId) return
      try {
        const projectsData = await projectService.getProjects(currentAccountId)
        setProjects(projectsData)
      } catch (error) {
        console.error('Error loading projects:', error)
      }
    }
    loadProjects()
  }, [currentAccountId])

  // Load tax presets on mount
  useEffect(() => {
    const loadPresets = async () => {
      if (!currentAccountId) return
      try {
        const presets = await getTaxPresets(currentAccountId)
        setTaxPresets(presets)
      } catch (error) {
        console.error('Error loading tax presets:', error)
      }
    }
    loadPresets()
  }, [currentAccountId])

  // Update selected preset rate when preset changes
  useEffect(() => {
    if (taxRatePreset && taxRatePreset !== 'Other') {
      const preset = taxPresets.find(p => p.id === taxRatePreset)
      setSelectedPresetRate(preset?.rate)
    } else {
      setSelectedPresetRate(undefined)
    }
    // Clear general error when tax preset changes
    if (formErrors.general) {
      setFormErrors(prev => ({ ...prev, general: '' }))
    }
  }, [taxRatePreset, taxPresets])

  // Clear general error when subtotal changes
  useEffect(() => {
    if (formErrors.general) {
      setFormErrors(prev => ({ ...prev, general: '' }))
    }
  }, [subtotal])

  const handleInputChange = (field: keyof typeof formData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }))
    }
    // Clear general error when any field changes
    if (formErrors.general) {
      setFormErrors(prev => ({ ...prev, general: '' }))
    }
  }

  const validateForm = () => {
    const errors: Record<string, string> = {}

    // Project selection is optional

    // Transaction date is optional

    if (!formData.source.trim()) {
      errors.source = 'Source is required'
    }

    if (!formData.categoryId?.trim()) {
      errors.categoryId = 'Budget category is required'
    }

    if (!formData.amount.trim()) {
      errors.amount = 'Amount is required'
    } else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
      errors.amount = 'Amount must be a positive number'
    }

    // Tax validation for Other
    if (taxRatePreset === 'Other') {
      if (!subtotal.trim() || isNaN(Number(subtotal)) || Number(subtotal) <= 0) {
        errors.general = 'Subtotal must be provided and greater than 0 when Tax Rate Preset is Other.'
      } else if (Number(formData.amount) < Number(subtotal)) {
        errors.general = 'Subtotal cannot exceed the total amount.'
      }
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      // Business inventory transactions always have projectId set to null
      const projectId = null
      const projectName = null

      if (!user?.id) {
        setFormErrors({ general: 'User must be authenticated to create transactions' })
        setIsSubmitting(false)
        return
      }

      if (!currentAccountId) {
        setFormErrors({ general: 'Account ID is required' })
        setIsSubmitting(false)
        return
      }

      const newTransaction: Omit<Transaction, 'transactionId' | 'createdAt'> = {
        ...formData,
        projectId: projectId,
        projectName: projectName,
        createdBy: user.id,
        taxRatePreset: taxRatePreset,
        subtotal: taxRatePreset === 'Other' ? subtotal : ''
      }
      await transactionService.createTransaction(currentAccountId, projectId, newTransaction, [])
      navigate(`/business-inventory`)
    } catch (error) {
      console.error('Error creating transaction:', error)
      setFormErrors({ general: 'Error creating transaction. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        {/* Back button row */}
        <div className="flex items-center justify-between">
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </ContextBackLink>
          {hasSyncError && <RetrySyncButton size="sm" variant="secondary" />}
        </div>
      </div>

      {/* Form */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Add Transaction</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-8 p-8">
          {/* General Error Display */}
          {formErrors.general && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{formErrors.general}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Transaction Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Transaction Source *
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              {availableVendors.map((source) => (
                <div key={source} className="flex items-center">
                  <input
                    type="radio"
                    id={`source_${source.toLowerCase().replace(/\s+/g, '_')}`}
                    name="source"
                    value={source}
                    checked={formData.source === source}
                    onChange={(e) => {
                      handleInputChange('source', e.target.value)
                      setIsCustomSource(false)
                    }}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <label htmlFor={`source_${source.toLowerCase().replace(/\s+/g, '_')}`} className="ml-2 block text-sm text-gray-900">
                    {source}
                  </label>
                </div>
              ))}
            </div>
            <div className="flex items-center">
              <input
                type="radio"
                id="source_custom"
                name="source"
                value="custom"
                checked={isCustomSource}
                onChange={() => {
                  setIsCustomSource(true)
                  handleInputChange('source', '')
                }}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
              />
              <label htmlFor="source_custom" className="ml-2 block text-sm text-gray-900">
                Other
              </label>
            </div>
            {isCustomSource && (
              <input
                type="text"
                id="source_custom_input"
                value={formData.source}
                onChange={(e) => handleInputChange('source', e.target.value)}
                placeholder="Enter custom source..."
                className={`mt-3 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  formErrors.source ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            )}
            {formErrors.source && (
              <p className="mt-1 text-sm text-red-600">{formErrors.source}</p>
            )}
          </div>

          {/* Budget Category */}
          <div>
            <CategorySelect
              value={formData.categoryId}
              onChange={(categoryId) => {
                setFormData(prev => ({ ...prev, categoryId }))
                if (formErrors.categoryId) {
                  setFormErrors(prev => ({ ...prev, categoryId: undefined }))
                }
              }}
              label="Budget Category"
              error={formErrors.categoryId}
              required
            />
          </div>

          {/* Transaction Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Transaction Type
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="type_purchase"
                  name="transactionType"
                  value="Purchase"
                  checked={formData.transactionType === 'Purchase'}
                  onChange={(e) => handleInputChange('transactionType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="type_purchase" className="ml-2 block text-sm text-gray-900">
                  Purchase
                </label>
              </div>
              {/* 'Reimbursement' option removed */}
              <div className="flex items-center">
                <input
                  type="radio"
                  id="type_return"
                  name="transactionType"
                  value="Return"
                  checked={formData.transactionType === 'Return'}
                  onChange={(e) => handleInputChange('transactionType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="type_return" className="ml-2 block text-sm text-gray-900">
                  Return
                </label>
              </div>
            </div>
            {formErrors.transactionType && (
              <p className="mt-1 text-sm text-red-600">{formErrors.transactionType}</p>
            )}
          </div>

          {/* Reimbursement Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Reimbursement Type
            </label>
            <p className="mb-3 text-xs text-gray-500">Flags transactions that require reimbursement</p>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="radio"
                id="reimbursement_none"
                  name="reimbursementType"
                  value=""
                  checked={!formData.reimbursementType}
                  onChange={(e) => handleInputChange('reimbursementType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="reimbursement_none" className="ml-2 block text-sm text-gray-900">
                  None
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="reimbursement_client_owes"
                  name="reimbursementType"
                  value={CLIENT_OWES_COMPANY}
                  checked={formData.reimbursementType === CLIENT_OWES_COMPANY}
                  onChange={(e) => handleInputChange('reimbursementType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="reimbursement_client_owes" className="ml-2 block text-sm text-gray-900">
                  {CLIENT_OWES_COMPANY}
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="reimbursement_we_owe"
                  name="reimbursementType"
                  value={COMPANY_OWES_CLIENT}
                  checked={formData.reimbursementType === COMPANY_OWES_CLIENT}
                  onChange={(e) => handleInputChange('reimbursementType', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="reimbursement_we_owe" className="ml-2 block text-sm text-gray-900">
                  {COMPANY_OWES_CLIENT}
                </label>
              </div>
            </div>
            {formErrors.reimbursementType && (
              <p className="mt-1 text-sm text-red-600">{formErrors.reimbursementType}</p>
            )}
          </div>

          {/* Receipt Email Copy */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Receipt Email Copy
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                id="receipt_yes"
                  name="receiptEmailed"
                  checked={formData.receiptEmailed === true}
                  onChange={() => handleInputChange('receiptEmailed', true)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="receipt_yes" className="ml-2 block text-sm text-gray-900">
                  Yes
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                id="receipt_no"
                  name="receiptEmailed"
                  checked={formData.receiptEmailed === false}
                  onChange={() => handleInputChange('receiptEmailed', false)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="receipt_no" className="ml-2 block text-sm text-gray-900">
                  No
                </label>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
              Amount *
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="text"
                id="amount"
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                placeholder="0.00"
                className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  formErrors.amount ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {formErrors.amount && (
              <p className="mt-1 text-sm text-red-600">{formErrors.amount}</p>
            )}
          </div>

          {/* Tax Rate Presets */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Tax Rate Preset</label>
            <div className="space-y-2">
              {taxPresets.map((preset) => (
                <div key={preset.id} className="flex items-center">
                  <input
                    type="radio"
                    id={`tax_preset_${preset.id}`}
                    name="taxRatePreset"
                    value={preset.id}
                    checked={taxRatePreset === preset.id}
                    onChange={(e) => setTaxRatePreset(e.target.value)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <label htmlFor={`tax_preset_${preset.id}`} className="ml-2 block text-sm text-gray-900">
                    {preset.name} ({preset.rate}%)
                  </label>
                </div>
              ))}
              <div className="flex items-center">
                <input
                  type="radio"
                  id="tax_preset_other"
                  name="taxRatePreset"
                  value="Other"
                  checked={taxRatePreset === 'Other'}
                  onChange={(e) => setTaxRatePreset(e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="tax_preset_other" className="ml-2 block text-sm text-gray-900">
                  Other
                </label>
              </div>
            </div>
            {/* Show selected tax rate for presets */}
            {taxRatePreset && taxRatePreset !== 'Other' && selectedPresetRate !== undefined && (
              <div className="mt-3 p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Tax Rate:</span> {selectedPresetRate}%
                </p>
              </div>
            )}
          </div>

          {/* Subtotal (shown only for Other) */}
          {taxRatePreset === 'Other' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Subtotal</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">$</span>
                </div>
                <input
                  type="text"
                  id="subtotal"
                  value={subtotal}
                  onChange={(e) => setSubtotal(e.target.value)}
                  placeholder="0.00"
                  className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 border-gray-300`}
                />
              </div>
              <p className="mt-1 text-sm text-gray-500">This will be used to calculate the tax rate.</p>
            </div>
          )}

          {/* Transaction Date */}
          <div>
              <label htmlFor="transactionDate" className="block text-sm font-medium text-gray-700">
              Transaction Date
            </label>
            <input
              type="date"
              id="transactionDate"
              value={formData.transactionDate}
              onChange={(e) => handleInputChange('transactionDate', e.target.value)}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                formErrors.transactionDate ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {formErrors.transactionDate && (
              <p className="mt-1 text-sm text-red-600">{formErrors.transactionDate}</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes
            </label>
            <textarea
              id="notes"
              rows={3}
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              placeholder="Additional notes about this transaction..."
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                formErrors.notes ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {formErrors.notes && (
              <p className="mt-1 text-sm text-red-600">{formErrors.notes}</p>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-4">
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </ContextBackLink>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Creating...' : 'Create Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
