import { ArrowLeft, Save, X, Shield } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useState, FormEvent, useEffect, useMemo, useRef } from 'react'
import { unifiedItemsService, transactionService } from '@/services/inventoryService'
import { ImageUploadService } from '@/services/imageService'
import { Transaction, ItemImage } from '@/types'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import { TransactionSource } from '@/constants/transactionSources'
import { Combobox } from '@/components/ui/Combobox'
import ImagePreview from '@/components/ui/ImagePreview'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { useAuth } from '../contexts/AuthContext'
import { useAccount } from '../contexts/AccountContext'
import { UserRole } from '../types'
import { getUserFriendlyErrorMessage, getErrorAction } from '@/utils/imageUtils'
import { useToast } from '@/components/ui/ToastContext'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { hydrateOptimisticItem } from '@/utils/hydrationHelpers'
import { OfflineQueueUnavailableError } from '@/services/offlineItemService'
import { OfflineContextError } from '@/services/operationQueue'
import { useBusinessInventoryRealtime } from '@/contexts/BusinessInventoryRealtimeContext'

import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE } from '@/constants/company'

// Get canonical transaction title for display
const getCanonicalTransactionTitle = (transaction: Transaction): string => {
  // Check if this is a canonical inventory transaction
  if (transaction.transactionId?.startsWith('INV_SALE_')) {
    return COMPANY_INVENTORY_SALE
  }
  if (transaction.transactionId?.startsWith('INV_PURCHASE_')) {
    return COMPANY_INVENTORY_PURCHASE
  }
  // Return the original source for non-canonical transactions
  return transaction.source
}

export default function AddBusinessInventoryItem() {
  const navigate = useNavigate()
  const location = useLocation()
  const hasSyncError = useSyncError()
  const { hasRole } = useAuth()
  const { currentAccountId } = useAccount()
  const { refreshCollections } = useBusinessInventoryRealtime()
  const { showError, showSuccess } = useToast()
  const { showOfflineSaved } = useOfflineFeedback()

  // Navigation context logic
  const backDestination = useMemo(() => {
    // Check if we have a returnTo parameter
    const searchParams = new URLSearchParams(location.search)
    const returnTo = searchParams.get('returnTo')
    if (returnTo) return returnTo

    // Default fallback
    return '/business-inventory'
  }, [location.search])

  // Check if user has permission to add items (USER role or higher)
  if (!hasRole(UserRole.USER)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <Shield className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">
            You don't have permission to add items. Please contact an administrator if you need access.
          </p>
          <ContextBackLink
            fallback={backDestination}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            Back to Business Inventory
          </ContextBackLink>
        </div>
      </div>
    )
  }

  const [formData, setFormData] = useState<{
    description: string
    source: string
    sku: string
    purchasePrice: string
    projectPrice: string
    marketValue: string
    disposition: string
    notes: string
    businessInventoryLocation: string
    selectedTransactionId: string
  }>({
    description: '',
    source: '',
    sku: '',
    purchasePrice: '',
    projectPrice: '',
    marketValue: '',
    disposition: 'inventory',
    notes: '',
    businessInventoryLocation: '',
    selectedTransactionId: ''
  })

  const [isCustomSource, setIsCustomSource] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [images, setImages] = useState<ItemImage[]>([])
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)

  // Track if user has manually edited project_price
  const projectPriceEditedRef = useRef(false)

  // Track if transaction is selected to hide source/payment method fields
  const isTransactionSelected = Boolean(formData.selectedTransactionId)

  // Fetch transactions when component mounts
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!currentAccountId) return
      setLoadingTransactions(true)
      try {
        // Get inventory-related transactions from top-level collection
        const allTransactions: Transaction[] = []

        // Get inventory-related transactions (reimbursement_type in ['Client Owes', 'We Owe'])
        const inventoryRelatedTransactions = await transactionService.getInventoryRelatedTransactions(currentAccountId)
        allTransactions.push(...inventoryRelatedTransactions)

        // Sort by creation date, newest first
        allTransactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setTransactions(allTransactions)
      } catch (error) {
        console.error('Error fetching transactions:', error)
      } finally {
        setLoadingTransactions(false)
      }
    }

    fetchTransactions()
  }, [currentAccountId])

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

  // Initialize custom states based on initial form data
  useEffect(() => {
    if (formData.source && !availableVendors.includes(formData.source)) {
      setIsCustomSource(true)
    } else if (formData.source && availableVendors.includes(formData.source)) {
      setIsCustomSource(false)
    }
  }, [formData.source, availableVendors])

  // NOTE: Do not auto-fill projectPrice while the user is typing. Defaulting to
  // purchasePrice should happen only when the user saves the item.

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!errors.description) return
    if (formData.description.trim() || images.length > 0) {
      setErrors(prev => ({ ...prev, description: '' }))
    }
  }, [errors.description, formData.description, images.length])

  // Validation function
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.description.trim() && images.length === 0) {
      newErrors.description = 'Add a description or at least one image'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsSubmitting(true)

    try {
      const itemData = {
        description: formData.description,
        source: formData.source,
        sku: formData.sku,
        purchasePrice: formData.purchasePrice,
        // Default projectPrice to purchasePrice at save time when left blank
        projectPrice: formData.projectPrice || formData.purchasePrice,
        marketValue: formData.marketValue,
          disposition: formData.disposition || 'inventory',
        notes: formData.notes,
        businessInventoryLocation: formData.businessInventoryLocation,
        qrKey: `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        bookmark: false,
        transactionId: formData.selectedTransactionId || '', // Use selected transaction or empty string
        inventoryStatus: 'available' as const,
        paymentMethod: 'Cash', // Default payment method for business inventory
        dateCreated: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        ...(images.length > 0 && { images }) // Only include images field if there are images
      }

      if (!currentAccountId) {
        showError('Account ID is required')
        return
      }
      const createResult = await unifiedItemsService.createItem(currentAccountId, itemData)

      // Hydrate optimistic item into React Query cache immediately
      await hydrateOptimisticItem(currentAccountId, createResult.itemId, itemData)

      try {
        await refreshCollections()
      } catch (error) {
        console.debug('AddBusinessInventoryItem: realtime refresh failed', error)
      }

      // Show appropriate feedback based on mode
      if (createResult.mode === 'offline') {
        showOfflineSaved(createResult.operationId)
      } else {
        showSuccess('Item saved successfully')
      }

      navigate(`/business-inventory/${createResult.itemId}`, { replace: true })
    } catch (error) {
      console.error('Error creating item:', error)
      if (error instanceof OfflineQueueUnavailableError) {
        setErrors({ submit: 'Offline storage is unavailable. Please refresh or try again online.' })
        showError('Offline storage is unavailable. Please refresh or try again online.')
        return
      }
      if (error instanceof OfflineContextError) {
        setErrors({ submit: 'Sign in before working offline so we can save your changes.' })
        showError('Sign in before working offline so we can save your changes.')
        return
      }
      setErrors({ submit: 'Failed to create item. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Mark projectPrice as manually edited if user is editing it
    if (field === 'projectPrice') {
      projectPriceEditedRef.current = true
    }

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const handleTransactionChange = (transactionId: string) => {
    const selectedTransaction = transactions.find(t => t.transactionId === transactionId)

    setFormData(prev => ({
      ...prev,
      selectedTransactionId: transactionId,
      // Pre-fill source from selected transaction
      source: selectedTransaction?.source || ''
    }))

    // Update custom state based on pre-filled values
    if (selectedTransaction?.source) {
      const isPredefinedSource = availableVendors.includes(selectedTransaction.source)
      setIsCustomSource(!isPredefinedSource)
    }

    // Clear error when user makes selection
    if (errors.selectedTransactionId) {
      setErrors(prev => ({ ...prev, selectedTransactionId: '' }))
    }
  }

  const handleMultipleImageUpload = async (files: File[]) => {
    try {
      setIsUploadingImage(true)
      setUploadProgress(0)

      console.log('Starting multiple image upload for', files.length, 'files')

      const uploadResults = await ImageUploadService.uploadMultipleItemImages(
        files,
        'Business Inventory',
        'new-item', // temporary ID for new items
        (fileIndex, progress) => {
          // Show progress for current file being uploaded
          const overallProgress = Math.round(((fileIndex + progress.percentage / 100) / files.length) * 100)
          setUploadProgress(overallProgress)
        }
      )

      console.log('All uploads completed successfully:', uploadResults.length, 'images')

      // Convert upload results to ItemImage objects
      const newImages: ItemImage[] = uploadResults.map((result, index) => ({
        url: result.url,
        alt: result.fileName,
        isPrimary: images.length === 0 && index === 0, // First image is primary if no images exist
        uploadedAt: new Date(),
        fileName: result.fileName,
        size: result.size,
        mimeType: result.mimeType
      }))

      console.log('New image objects created:', newImages.length)

      // Update the images array
      setImages(prev => [...prev, ...newImages])
      setUploadProgress(100)

      console.log('Multiple image upload completed successfully')
    } catch (error) {
      console.error('Error uploading multiple images:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    } finally {
      setIsUploadingImage(false)
      setUploadProgress(0)
    }
  }

  const handleSelectFromGallery = async () => {
    try {
      setIsUploadingImage(true)
      const files = await ImageUploadService.selectFromGallery()

      if (files && files.length > 0) {
        console.log('Selected', files.length, 'files from gallery')
        await handleMultipleImageUpload(files)
      } else {
        console.log('No files selected from gallery')
      }
    } catch (error: any) {
      console.error('Error selecting from gallery:', error)

      // Handle cancel/timeout gracefully - don't show error for user cancellation
      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        console.log('User canceled image selection or selection timed out')
        return
      }

      // Show error for actual failures
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    } finally {
      setIsUploadingImage(false)
      setUploadProgress(0)
    }
  }

  const handleRemoveImage = async (imageUrl: string) => {
    // Remove from local state
    setImages(prev => prev.filter(img => img.url !== imageUrl))

    // Note: For new items, we don't need to delete from storage since they haven't been saved yet
    // The images will be cleaned up when the item is actually created
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
          <h1 className="text-2xl font-bold text-gray-900">Add Item</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-8 p-8">
          {/* Item Images */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Item Images
              </label>
              {images.length > 0 && (
                <button
                  onClick={handleSelectFromGallery}
                  disabled={isUploadingImage || images.length >= 5}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  {isUploadingImage
                    ? uploadProgress > 0 && uploadProgress < 100
                      ? `Uploading... ${Math.round(uploadProgress)}%`
                      : 'Uploading...'
                    : images.length >= 5
                      ? 'Max reached'
                      : 'Add Images'
                  }
                </button>
              )}
            </div>

            {images.length > 0 ? (
              <ImagePreview
                images={images}
                onRemoveImage={handleRemoveImage}
                maxImages={5}
                size="md"
                showControls={true}
              />
            ) : (
              <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                <p className="text-sm text-gray-500 mb-3">No images for this item yet</p>
                <button
                  onClick={handleSelectFromGallery}
                  disabled={isUploadingImage}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  {isUploadingImage
                    ? uploadProgress > 0 && uploadProgress < 100
                      ? `Uploading... ${Math.round(uploadProgress)}%`
                      : 'Uploading...'
                    : 'Add Images'
                  }
                </button>
              </div>
            )}
          </div>

          {/* SKU */}
                <div>
                  <label htmlFor="sku" className="block text-sm font-medium text-gray-700">
                    SKU
                  </label>
                  <input
                    type="text"
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => handleInputChange('sku', e.target.value)}
              placeholder="Product SKU or model number"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
                  <input
                    type="text"
                    id="description"
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="e.g., Wooden dining table, 6 chairs"
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                errors.description ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
            {errors.description && (
              <p className="mt-1 text-sm text-red-600">{errors.description}</p>
                  )}
                </div>

          {/* Transaction Selection */}
          <Combobox
            label="Associate with Transaction"
            value={formData.selectedTransactionId}
            onChange={handleTransactionChange}
            error={errors.selectedTransactionId}
            disabled={loadingTransactions}
            loading={loadingTransactions}
            placeholder={loadingTransactions ? "Loading transactions..." : "Select a transaction"}
            options={
              loadingTransactions ? [] : [
                { id: '', label: 'Select a transaction' },
                ...transactions.map((transaction) => ({
                  id: transaction.transactionId,
                  label: `${new Date(transaction.transactionDate).toLocaleDateString()} - ${getCanonicalTransactionTitle(transaction)} - $${transaction.amount}`
                }))
              ]
            }
          />
          {!loadingTransactions && transactions.length === 0 && (
            <p className="mt-1 text-sm text-gray-500">No transactions available</p>
          )}

          {/* Show transaction info when selected */}
          {isTransactionSelected && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm text-blue-800">
                <strong>Source:</strong> {formData.source}
              </p>
              <p className="text-xs text-blue-600 mt-1">
                These values are automatically filled from the selected transaction
              </p>
            </div>
          )}

          {/* Source */}
          {!isTransactionSelected && (
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Source
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
                    errors.source ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
              )}
              {errors.source && (
                <p className="mt-1 text-sm text-red-600">{errors.source}</p>
              )}
            </div>
          )}


            {/* Purchase Price */}
            <div>
              <label htmlFor="purchasePrice" className="block text-sm font-medium text-gray-700">
                Purchase Price
              </label>
              <p className="text-xs text-gray-500 mt-1 mb-2">What the item was purchased for</p>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="text"
                id="purchasePrice"
                value={formData.purchasePrice}
                onChange={(e) => handleInputChange('purchasePrice', e.target.value)}
                placeholder="0.00"
                className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  errors.purchasePrice ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.purchasePrice && (
              <p className="mt-1 text-sm text-red-600">{errors.purchasePrice}</p>
            )}
          </div>

          {/* Project Price */}
          <div>
            <label htmlFor="projectPrice" className="block text-sm font-medium text-gray-700">
              Project Price
            </label>
            <p className="text-xs text-gray-500 mt-1 mb-2">What the client is charged (defaults to purchase price)</p>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="text"
                id="projectPrice"
                value={formData.projectPrice}
                onChange={(e) => handleInputChange('projectPrice', e.target.value)}
                placeholder="0.00"
                className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  errors.projectPrice ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.projectPrice && (
              <p className="mt-1 text-sm text-red-600">{errors.projectPrice}</p>
            )}
          </div>

          {/* Market Value */}
          <div>
            <label htmlFor="marketValue" className="block text-sm font-medium text-gray-700">
              Market Value
            </label>
            <p className="text-xs text-gray-500 mt-1 mb-2">The fair market value of the item</p>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="text"
                id="marketValue"
                value={formData.marketValue}
                onChange={(e) => handleInputChange('marketValue', e.target.value)}
                placeholder="0.00"
                className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  errors.marketValue ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.marketValue && (
              <p className="mt-1 text-sm text-red-600">{errors.marketValue}</p>
            )}
          </div>

          {/* Storage Location */}
                <div>
                  <label htmlFor="businessInventoryLocation" className="block text-sm font-medium text-gray-700">
                    Storage Location
                  </label>
                  <input
                    type="text"
                    id="businessInventoryLocation"
                    value={formData.businessInventoryLocation}
                    onChange={(e) => handleInputChange('businessInventoryLocation', e.target.value)}
                    placeholder="e.g., Warehouse A - Section 3 - Shelf 5"
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                errors.businessInventoryLocation ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {errors.businessInventoryLocation && (
              <p className="mt-1 text-sm text-red-600">{errors.businessInventoryLocation}</p>
                  )}
                </div>

          {/* Disposition */}
            <div>
              <label htmlFor="disposition" className="block text-sm font-medium text-gray-700">
                Disposition
              </label>
              <p className="text-xs text-gray-500 mt-1 mb-2">What should happen to this item in business inventory</p>
              <div className="mt-1">
                <Combobox
                  value={formData.disposition}
                  onChange={(value) => handleInputChange('disposition', value)}
                  placeholder="Select a disposition"
                  options={[
                    { id: 'to purchase', label: 'To Purchase' },
                    { id: 'purchased', label: 'Purchased' },
                    { id: 'to return', label: 'To Return' },
                    { id: 'returned', label: 'Returned' },
                    { id: 'inventory', label: 'Inventory' }
                  ]}
                />
              </div>
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
                    placeholder="Additional notes about this item..."
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

          {/* Error message */}
          {errors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{errors.submit}</p>
              </div>
            )}

          {/* Form Actions - Normal on desktop, hidden on mobile (replaced by sticky bar) */}
          <div className="hidden sm:flex justify-end sm:space-x-3 pt-4">
            <ContextBackLink
              fallback={backDestination}
              className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </ContextBackLink>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>

      {/* Sticky mobile action bar */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50">
        <div className="flex space-x-3">
          <ContextBackLink
            fallback={backDestination}
            className="flex-1 inline-flex justify-center items-center px-4 py-3 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </ContextBackLink>
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
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {/* Add bottom padding to account for sticky bar on mobile */}
      <div className="sm:hidden h-20"></div>
    </div>
  )
}
