import { AlertTriangle, ArrowLeft, Save, X } from 'lucide-react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useState, FormEvent, useEffect, useRef, useMemo } from 'react'
import { transactionService, projectService, unifiedItemsService } from '@/services/inventoryService'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { offlineMediaService } from '@/services/offlineMediaService'
import { TransactionSource } from '@/constants/transactionSources'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import { Transaction, ItemImage, ItemDisposition, Project } from '@/types'
import { Combobox } from '@/components/ui/Combobox'
import ImagePreview from '@/components/ui/ImagePreview'
import QuantityPill from '@/components/ui/QuantityPill'
import { useAuth } from '../contexts/AuthContext'
import { useAccount } from '../contexts/AccountContext'
import { UserRole } from '../types'
import { Shield } from 'lucide-react'
import { getUserFriendlyErrorMessage, getErrorAction } from '@/utils/imageUtils'
import { useToast } from '@/components/ui/ToastContext'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { useSyncError } from '@/hooks/useSyncError'
import { useNetworkState } from '@/hooks/useNetworkState'
import { DISPOSITION_OPTIONS, displayDispositionLabel } from '@/utils/dispositionUtils'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { OfflineQueueUnavailableError } from '@/services/offlineItemService'
import { OfflineContextError } from '@/services/operationQueue'
import { hydrateOptimisticItem } from '@/utils/hydrationHelpers'

import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, COMPANY_NAME } from '@/constants/company'
import { projectItems } from '@/utils/routes'
import { navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'
import SpeechMicButton from '@/components/ui/SpeechMicButton'
import { getProjectLocations } from '@/utils/locationPresets'

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

type AddItemFormData = {
  description: string
  source: string
  sku: string
  purchasePrice: string
  projectPrice: string
  marketValue: string
  paymentMethod: string
  space: string
  notes: string
  disposition: ItemDisposition
  selectedTransactionId: string
}

export default function AddItem() {
  const { id, projectId: routeProjectId } = useParams<{ id?: string; projectId?: string }>()
  const projectId = routeProjectId || id
  const navigate = useNavigate()
  const location = useLocation()
  const { getBackDestination } = useNavigationContext()
  const fallbackPath = useMemo(() => (projectId ? projectItems(projectId) : '/projects'), [projectId])

  const { hasRole } = useAuth()
  const { currentAccountId } = useAccount()
  const { showError, showSuccess } = useToast()
  const { showOfflineSaved } = useOfflineFeedback()
  const hasSyncError = useSyncError()
  const { isOnline } = useNetworkState()
  const clientGeneratedItemId = useMemo(
    () => `I-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    []
  )
  const offlineMediaIdsRef = useRef<Set<string>>(new Set())
  const itemSavedRef = useRef(false)

  const [projectName, setProjectName] = useState<string>('')
  const [project, setProject] = useState<Project | null>(null)

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
            fallback={getBackDestination(fallbackPath)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            Back to Project
          </ContextBackLink>
        </div>
      </div>
    )
  }

  const [formData, setFormData] = useState<AddItemFormData>({
    description: '',
    source: '',
    sku: '',
    purchasePrice: '',
    projectPrice: '',
    marketValue: '',
    paymentMethod: '',
    space: '',
    notes: '',
    disposition: 'purchased',
    selectedTransactionId: ''
  })

  const [isCustomSource, setIsCustomSource] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [images, setImages] = useState<ItemImage[]>([])
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [quantity, setQuantity] = useState(1)

  // Track if user has manually edited project_price
  const projectPriceEditedRef = useRef(false)

  // Track if transaction is selected to hide source/payment method fields
  const isTransactionSelected = Boolean(formData.selectedTransactionId)

  // Fetch project name and transactions when component mounts
  useEffect(() => {
    const fetchProjectAndTransactions = async () => {
      if (projectId && currentAccountId) {
        setLoadingTransactions(true)
        try {
          // Fetch project name for image uploads and locations
          const fetchedProject = await projectService.getProject(currentAccountId, projectId)
          if (fetchedProject) {
            setProjectName(fetchedProject.name)
            setProject(fetchedProject)
          }

          // Fetch transactions
          const fetchedTransactions = await transactionService.getTransactions(currentAccountId, projectId)
          setTransactions(fetchedTransactions)
        } catch (error) {
          console.error('Error fetching project and transactions:', error)
        } finally {
          setLoadingTransactions(false)
        }
      }
    }

    fetchProjectAndTransactions()
  }, [projectId, currentAccountId])

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

  // Cleanup any queued offline media if user leaves without saving
  useEffect(() => {
    return () => {
      if (itemSavedRef.current) return
      const mediaIds = Array.from(offlineMediaIdsRef.current)
      mediaIds.forEach(mediaId => {
        offlineMediaService.deleteMediaFile(mediaId).catch(error => {
          console.warn('Failed to cleanup offline media on unmount:', error)
        })
      })
    }
  }, [])

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

    if (!validateForm() || !projectId) return

    setIsSubmitting(true)

    try {
      const itemData = {
        ...formData,
        projectId: projectId,
        qrKey: `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        bookmark: false,
        // Default projectPrice to purchasePrice at save time when left blank
        projectPrice: formData.projectPrice || formData.purchasePrice,
        transactionId: formData.selectedTransactionId || '', // Use selected transaction or empty string
        dateCreated: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        disposition: formData.disposition || 'purchased',
        ...(images.length > 0 && { images }) // Only include images field if there are images
      }

      if (!currentAccountId) {
        showError('Account ID is required')
        return
      }

      const totalToCreate = Math.max(1, Math.floor(quantity))
      const createdItemIds: string[] = []
      let lastOfflineOperationId: string | undefined

      for (let index = 0; index < totalToCreate; index += 1) {
        const createResult = await unifiedItemsService.createItem(
          currentAccountId,
          itemData,
          index === 0 ? { clientItemId: clientGeneratedItemId } : undefined
        )
        createdItemIds.push(createResult.itemId)

        // Hydrate optimistic item into React Query cache immediately
        // This makes the item appear in lists before sync completes
        await hydrateOptimisticItem(currentAccountId, createResult.itemId, itemData)

        if (createResult.mode === 'offline') {
          lastOfflineOperationId = createResult.operationId
        }
      }

      itemSavedRef.current = true

      if (lastOfflineOperationId) {
        showOfflineSaved(lastOfflineOperationId)
      } else if (totalToCreate === 1) {
        showSuccess('Item saved successfully')
      } else {
        showSuccess(`Created ${totalToCreate} items successfully`)
      }

      navigateToReturnToOrFallback(navigate, location, fallbackPath)
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

  const handleInputChange = <K extends keyof AddItemFormData>(field: K, value: AddItemFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Mark project_price as manually edited if user is editing it
    if (field === 'projectPrice') {
      projectPriceEditedRef.current = true
    }

    // Clear error when user starts typing
    if (errors[field as string]) {
      setErrors(prev => ({ ...prev, [field as string]: '' }))
    }
  }

  const handleTransactionChange = (transactionId: string) => {
    const selectedTransaction = transactions.find(t => t.transactionId === transactionId)

    setFormData(prev => ({
      ...prev,
      selectedTransactionId: transactionId,
      // Pre-fill source and payment method from selected transaction
      source: selectedTransaction?.source || '',
      paymentMethod: selectedTransaction?.paymentMethod || ''
    }))

    // Update custom state based on pre-filled values
    if (selectedTransaction?.source) {
      const isPredefinedSource = availableVendors.includes(selectedTransaction.source as TransactionSource)
      setIsCustomSource(!isPredefinedSource)
    }


    // Clear error when user makes selection
    if (errors.selectedTransactionId) {
      setErrors(prev => ({ ...prev, selectedTransactionId: '' }))
    }
  }

  const handleMultipleImageUpload = async (files: File[]) => {
    if (!projectName) return
    if (!currentAccountId) {
      showError('Account ID is required to upload images.')
      return
    }

    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })

      console.log('Starting multiple image upload for', files.length, 'files')

      const newImages: ItemImage[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const uploadResult = await OfflineAwareImageService.uploadItemImage(
          file,
          projectName,
          clientGeneratedItemId,
          currentAccountId,
          progress => {
            const overallProgress = Math.round(((i + progress.percentage / 100) / files.length) * 100)
            setUploadProgress(overallProgress)
          }
        )

        const metadata = uploadResult.url.startsWith('offline://')
          ? {
              offlineMediaId: uploadResult.url.replace('offline://', ''),
              isOfflinePlaceholder: true
            }
          : undefined

        if (metadata?.offlineMediaId) {
          offlineMediaIdsRef.current.add(metadata.offlineMediaId)
        }

        newImages.push({
          url: uploadResult.url,
          alt: uploadResult.fileName,
          isPrimary: images.length === 0 && i === 0,
          uploadedAt: new Date(),
          fileName: uploadResult.fileName,
          size: uploadResult.size,
          mimeType: uploadResult.mimeType,
          metadata
        })
      }

      console.log('New image objects created:', newImages.length)

      setImages(prev => [...prev, ...newImages])
      setUploadProgress(100)

      if (!isOnline) {
        console.info('Images saved offline and queued for sync')
      } else {
        console.log('Multiple image upload completed successfully')
      }
    } catch (error) {
      console.error('Error uploading multiple images:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    } finally {
      setUploadsInFlight(count => {
        const next = Math.max(0, count - 1)
        if (next === 0) {
          setUploadProgress(0)
        }
        return next
      })
    }
  }

  const handleSelectFromGallery = async () => {
    if (!projectName) return

    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })
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
      setUploadsInFlight(count => {
        const next = Math.max(0, count - 1)
        if (next === 0) {
          setUploadProgress(0)
        }
        return next
      })
    }
  }

  const handleRemoveImage = async (imageUrl: string) => {
    if (imageUrl.startsWith('offline://')) {
      const mediaId = imageUrl.replace('offline://', '')
      offlineMediaIdsRef.current.delete(mediaId)
      try {
        await offlineMediaService.deleteMediaFile(mediaId)
      } catch (error) {
        console.warn('Failed to delete offline media file:', error)
      }
    }

    setImages(prev => prev.filter(img => img.url !== imageUrl))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        {/* Back button row */}
        <div className="flex items-center justify-between">
          <ContextBackLink
            fallback={getBackDestination(fallbackPath)}
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
          <p className="mt-1 text-sm text-gray-600">Add a description or at least one image to create an item.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-8 p-8">
          {/* Item Images */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Item Images
              </label>
              {images.length > 0 && (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={handleSelectFromGallery}
                    disabled={images.length >= 5}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    {images.length >= 5 ? 'Max reached' : 'Add Images'}
                  </button>
                  <UploadActivityIndicator isUploading={isUploadingImage} progress={uploadProgress} className="mt-1" />
                </div>
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
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSelectFromGallery}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    Add Images
                  </button>
                  <UploadActivityIndicator isUploading={isUploadingImage} progress={uploadProgress} className="mt-1" />
                </div>
              </div>
            )}
            {!isOnline && (
              <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                You're offline. Images are stored locally and will sync once you're back online.
              </p>
            )}
          </div>

          {/* SKU */}
          <div>
            <label htmlFor="sku" className="block text-sm font-medium text-gray-700">
              SKU
            </label>
            <div className="mt-1 relative">
              <input
                type="text"
                id="sku"
                value={formData.sku}
                onChange={(e) => handleInputChange('sku', e.target.value)}
                placeholder="Product SKU or model number"
                className="block w-full px-3 py-2 pr-12 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              <SpeechMicButton
                value={formData.sku}
                onChangeText={(next) => handleInputChange('sku', next)}
                label="SKU"
                append={false}
                normalize="sku"
              />
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">
              Quantity
            </label>
            <p className="text-xs text-gray-500 mt-1">Total number of items to create</p>
            <div className="mt-2">
              <QuantityPill
                value={quantity}
                onChange={setQuantity}
                min={1}
                className="px-1"
                inputId="quantity"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <div className="mt-1 relative">
              <input
                type="text"
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="e.g., Wooden dining table, 6 chairs"
                className={`block w-full px-3 py-2 pr-12 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  errors.description ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              <SpeechMicButton
                value={formData.description}
                onChangeText={(next) => handleInputChange('description', next)}
                label="Description"
                append={true}
              />
            </div>
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
            <p className="mt-1 text-sm text-gray-500">No transactions available for this project</p>
          )}

          {/* Show transaction info when selected */}
          {isTransactionSelected && (
            <div className="mt-2 p-3 bg-primary-50 border border-primary-100 rounded-md">
              <p className="text-sm text-primary-700">
                <strong>Source:</strong> {formData.source} |
                <strong> Payment Method:</strong> {formData.paymentMethod}
              </p>
              <p className="text-xs text-primary-600 mt-1">
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

          {/* Payment Method */}
          {!isTransactionSelected && formData.source !== 'Inventory' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Payment Method
            </label>
            <div className="flex items-center space-x-6 mb-3">
              {['Client Card', COMPANY_NAME].map((method) => (
                <div key={method} className="flex items-center">
                  <input
                    type="radio"
                    id={`payment_${method.toLowerCase().replace(/\s+/g, '_')}`}
                    name="paymentMethod"
                    value={method}
                    checked={formData.paymentMethod === method}
                    onChange={(e) => {
                      handleInputChange('paymentMethod', e.target.value)
                    }}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <label htmlFor={`payment_${method.toLowerCase().replace(/\s+/g, '_')}`} className="ml-2 block text-sm text-gray-900">
                    {method}
                  </label>
                </div>
              ))}
            </div>
            {errors.paymentMethod && (
              <p className="mt-1 text-sm text-red-600">{errors.paymentMethod}</p>
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



          {/* Space */}
          <div>
            <label htmlFor="space" className="block text-sm font-medium text-gray-700">
              Space
            </label>
            {projectId && project ? (
              <div className="mt-1">
                <Combobox
                  label=""
                  options={[
                    { id: '', label: 'No space set' },
                    ...getProjectLocations(project.settings).map(loc => ({ id: loc, label: loc }))
                  ]}
                  value={formData.space}
                  onChange={(value) => handleInputChange('space', value)}
                  placeholder="Select or create a location..."
                  allowCreate={Boolean(currentAccountId && projectId)}
                  onCreateOption={async (query: string) => {
                    if (!currentAccountId || !projectId) {
                      throw new Error('Project or account unavailable for location creation')
                    }
                    try {
                      const createdLocation = await projectService.addProjectLocation(
                        currentAccountId,
                        projectId,
                        query
                      )
                      // Refresh project to get updated locations
                      const updatedProject = await projectService.getProject(currentAccountId, projectId)
                      if (updatedProject) {
                        setProject(updatedProject)
                      }
                      return createdLocation
                    } catch (error) {
                      console.error('Failed to create location:', error)
                      throw error
                    }
                  }}
                />
              </div>
            ) : (
              <div className="mt-1">
                <input
                  type="text"
                  id="space"
                  value={formData.space}
                  onChange={(e) => handleInputChange('space', e.target.value)}
                  placeholder="Select a project to choose locations"
                  disabled
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-gray-500">Select a project to choose locations</p>
              </div>
            )}
          </div>

          {/* Disposition */}
          <div>
            <label htmlFor="disposition" className="block text-sm font-medium text-gray-700">
              Disposition
            </label>
            <p className="text-xs text-gray-500 mt-1 mb-2">What happens to this item after the project</p>
            <div className="mt-1">
              <Combobox
                value={formData.disposition}
                onChange={(value) => handleInputChange('disposition', value as ItemDisposition)}
                placeholder="Select a disposition"
                options={DISPOSITION_OPTIONS.map(option => ({
                  id: option,
                  label: displayDispositionLabel(option)
                }))}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes
            </label>
            <div className="mt-1 relative">
              <textarea
                id="notes"
                rows={3}
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="Additional notes about this item..."
                className="block w-full px-3 py-2 pr-12 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              <SpeechMicButton
                value={formData.notes}
                onChangeText={(next) => handleInputChange('notes', next)}
                label="Notes"
                append={true}
                className="top-3 translate-y-0"
              />
            </div>
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
            fallback={getBackDestination(fallbackPath)}
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
            fallback={getBackDestination(projectId ? projectItems(projectId) : '/projects')}
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
