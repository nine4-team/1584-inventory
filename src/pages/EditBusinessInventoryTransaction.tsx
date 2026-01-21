import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useStackedNavigate } from '@/hooks/useStackedNavigate'
import { ArrowLeft, Save, X } from 'lucide-react'
import { Transaction, Project, TaxPreset } from '@/types'
import { CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { transactionService, projectService } from '@/services/inventoryService'
import { toDateOnlyString } from '@/utils/dateUtils'
import { getTaxPresets } from '@/services/taxPresetsService'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import { useAccount } from '@/contexts/AccountContext'
import CategorySelect from '@/components/CategorySelect'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { hydrateTransactionCache } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'
import { useBusinessInventoryRealtime } from '@/contexts/BusinessInventoryRealtimeContext'

export default function EditBusinessInventoryTransaction() {
  const { projectId, transactionId } = useParams<{ projectId: string; transactionId: string }>()
  const navigate = useStackedNavigate()
  const location = useLocation()
  const hasSyncError = useSyncError()
  const { currentAccountId } = useAccount()
  const { refreshCollections } = useBusinessInventoryRealtime()
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [, setProjects] = useState<Project[]>([])
  const [transaction, setTransaction] = useState<Transaction | null>(null)
  const [formData, setFormData] = useState({
    projectId: '',
    transactionDate: '',
    source: '',
    transactionType: 'Purchase',
    paymentMethod: 'Pending',
    amount: '',
    categoryId: '',
    notes: '',
    status: 'pending' as 'pending' | 'completed' | 'canceled',
    reimbursementType: '' as '' | typeof CLIENT_OWES_COMPANY | typeof COMPANY_OWES_CLIENT | null | undefined,
    triggerEvent: 'Manual' as 'Inventory allocation' | 'Inventory return' | 'Inventory sale' | 'Purchase from client' | 'Manual',
    receiptEmailed: false
  })
  const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({})
  const [isCustomSource, setIsCustomSource] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])
  const availableVendorsRef = useRef<string[]>([])
  const lastLoggedTransactionIdRef = useRef<string | null>(null)

  // Load vendor defaults on mount
  useEffect(() => {
    const loadVendors = async () => {
      if (!currentAccountId) {
        setAvailableVendors([])
        availableVendorsRef.current = []
        return
      }
      try {
        const vendors = await getAvailableVendors(currentAccountId)
        setAvailableVendors(vendors)
        availableVendorsRef.current = vendors
      } catch (error) {
        console.error('Error loading vendor defaults:', error)
        setAvailableVendors([])
        availableVendorsRef.current = []
      }
    }
    loadVendors()
  }, [currentAccountId])

  // Tax form state
  const [taxRatePreset, setTaxRatePreset] = useState<string | undefined>(undefined)
  const [subtotal, setSubtotal] = useState<string>('')
  const [taxPresets, setTaxPresets] = useState<TaxPreset[]>([])
  const [selectedPresetRate, setSelectedPresetRate] = useState<number | undefined>(undefined)

  // Navigation context logic
  const backDestination = useMemo(() => {
    // Check if we have a returnTo parameter
    const searchParams = new URLSearchParams(location.search)
    const returnTo = searchParams.get('returnTo')
    if (returnTo) return returnTo

    // Default fallback
    return '/business-inventory'
  }, [location.search])

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

  // Load projects and transaction data
  useEffect(() => {
    if (!transactionId) {
      console.error('EditBusinessInventoryTransaction: transactionId is required in the route params.')
      setIsLoading(false)
      return
    }

    if (!currentAccountId) {
      return
    }

    const loadData = async () => {
      try {
        // Handle 'null' string placeholder for business inventory transactions (projectId is null)
        const actualProjectId = projectId === 'null' ? '' : (projectId || '')
        
        // First, try to hydrate from offlineStore to React Query cache
        // This ensures optimistic transactions created offline are available
        try {
          await hydrateTransactionCache(getGlobalQueryClient(), currentAccountId, transactionId)
        } catch (error) {
          console.warn('Failed to hydrate transaction cache (non-fatal):', error)
        }

        // Check React Query cache first (for optimistic transactions created offline)
        const queryClient = getGlobalQueryClient()
        const cachedTransaction = queryClient.getQueryData<Transaction>(['transaction', currentAccountId, transactionId])
        
        let transactionData: Transaction | null = null
        if (cachedTransaction) {
          if (lastLoggedTransactionIdRef.current !== cachedTransaction.transactionId) {
            console.log('✅ Transaction found in React Query cache:', cachedTransaction.transactionId)
            lastLoggedTransactionIdRef.current = cachedTransaction.transactionId
          }
          transactionData = cachedTransaction
        }

        // If not in cache, fetch from service (which will check cache/offlineStore/network)
        if (!transactionData) {
          transactionData = await transactionService.getTransaction(currentAccountId, actualProjectId, transactionId)
        }

        const projectsData = await projectService.getProjects(currentAccountId)

        setProjects(projectsData)

        if (transactionData) {
          setTransaction(transactionData)
          const resolvedSource = transactionData.source || ''
          const sourceIsCustom = Boolean(resolvedSource && !availableVendorsRef.current.includes(resolvedSource))
          
          setFormData({
            projectId: transactionData.projectId || '',
            transactionDate: toDateOnlyString(transactionData.transactionDate) || '',
            source: resolvedSource,
            transactionType: transactionData.transactionType || 'Purchase',
            paymentMethod: transactionData.paymentMethod || 'Pending',
            amount: transactionData.amount,
            categoryId: transactionData.categoryId || '',
            notes: transactionData.notes || '',
            status: transactionData.status || 'pending',
            reimbursementType: transactionData.reimbursementType || '',
            triggerEvent: transactionData.triggerEvent || 'Manual',
            receiptEmailed: transactionData.receiptEmailed || false
          })

          // Populate tax fields if present
          if (transactionData.taxRatePreset) {
            setTaxRatePreset(transactionData.taxRatePreset)
          }
          setSubtotal(transactionData.subtotal || '')
          
          setIsCustomSource(sourceIsCustom)
        }
      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [projectId, transactionId, currentAccountId])

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

    if (!projectId || !transactionId || !validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      // Business inventory transactions always have projectId set to null
      const actualProjectId = null

      const updateData: Partial<Transaction> = {
        ...formData,
        projectId: actualProjectId,
        // Allow explicit clearing via "None" (persist NULLs).
        ...(taxRatePreset
          ? { taxRatePreset: taxRatePreset, subtotal: taxRatePreset === 'Other' ? subtotal : null }
          : { taxRatePreset: null, subtotal: null })
      }

      if (!currentAccountId) {
        setFormErrors({ general: 'Account ID is required' })
        setIsSubmitting(false)
        return
      }
      await transactionService.updateTransaction(currentAccountId, actualProjectId || '', transactionId, updateData)
      try {
        await refreshCollections()
      } catch (error) {
        console.debug('EditBusinessInventoryTransaction: realtime refresh failed', error)
      }
      navigate(`/business-inventory`)
    } catch (error) {
      console.error('Error updating transaction:', error)
      setFormErrors({ general: 'Error updating transaction. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    navigate(backDestination)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!transaction) {
    return (
      <div className="text-center py-12 px-4">
        <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">🧾</div>
        <h3 className="text-lg font-medium text-gray-900 mb-1">
          Transaction not found
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          The transaction you're looking for doesn't exist or has been deleted.
        </p>
        <ContextBackLink
          fallback={backDestination}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
        >
          Back to Business Inventory
        </ContextBackLink>
      </div>
    )
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
          <h1 className="text-2xl font-bold text-gray-900">Edit Transaction</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
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

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Source/Vendor *
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
              <div className="flex items-center">
                <input
                  type="radio"
                  id="tax_preset_none"
                  name="taxRatePreset"
                  value=""
                  checked={!taxRatePreset}
                  onChange={() => {
                    setTaxRatePreset(undefined)
                    setSubtotal('')
                  }}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="tax_preset_none" className="ml-2 block text-sm text-gray-900">
                  None
                </label>
              </div>
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

          {/* Form Actions - Normal on desktop, hidden on mobile (replaced by sticky bar) */}
          <div className="hidden sm:flex justify-end sm:space-x-3 pt-4">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Updating...' : 'Update'}
            </button>
          </div>
        </form>
      </div>

      {/* Sticky mobile action bar */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50">
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 inline-flex justify-center items-center px-4 py-3 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            onClick={(e) => {
              // Find the form and submit it
              const form = e.currentTarget.closest('.space-y-6')?.querySelector('form') as HTMLFormElement
              if (form) {
                form.requestSubmit()
              }
            }}
            className="flex-1 inline-flex justify-center items-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>

      {/* Add bottom padding to account for sticky bar on mobile */}
      <div className="sm:hidden h-20"></div>
    </div>
  )
}
