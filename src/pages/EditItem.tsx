import { ArrowLeft, ImagePlus, Save, X } from 'lucide-react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useState, FormEvent, useEffect, useRef, useMemo } from 'react'
import { projectService, transactionService, unifiedItemsService } from '@/services/inventoryService'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import { ItemImage, Transaction } from '@/types'
import { Combobox } from '@/components/ui/Combobox'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { useAuth } from '../contexts/AuthContext'
import { useAccount } from '../contexts/AccountContext'
import { UserRole } from '../types'
import { Shield } from 'lucide-react'
import { hydrateProjectTransactionsCache } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'
import ImagePreview from '@/components/ui/ImagePreview'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { offlineMediaService } from '@/services/offlineMediaService'
import { getUserFriendlyErrorMessage, getErrorAction } from '@/utils/imageUtils'
import { useToast } from '@/components/ui/ToastContext'
import { useNetworkState } from '@/hooks/useNetworkState'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'

import { COMPANY_INVENTORY_SALE, COMPANY_INVENTORY_PURCHASE, COMPANY_NAME } from '@/constants/company'
import { projectItemDetail, projectItems } from '@/utils/routes'
import { getReturnToFromLocation, navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'

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

export default function EditItem() {
  const { id, projectId: routeProjectId, itemId } = useParams<{ id?: string; projectId?: string; itemId?: string }>()
  const projectId = routeProjectId || id
  const navigate = useNavigate()
  const hasSyncError = useSyncError()
  const location = useLocation()
  const { hasRole } = useAuth()
  const { currentAccountId } = useAccount()
  const { showError } = useToast()
  const { isOnline } = useNetworkState()

  const fallbackPath = useMemo(() => {
    if (projectId && itemId) return projectItemDetail(projectId, itemId)
    if (projectId) return projectItems(projectId)
    return '/projects'
  }, [projectId, itemId])

  // Get returnTo parameter for back navigation
  const getBackDestination = () => {
    const returnTo = getReturnToFromLocation(location)
    if (returnTo) return returnTo
    return fallbackPath
  }

  // Check if user has permission to edit items (USER role or higher)
  if (!hasRole(UserRole.USER)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <Shield className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">
            You don't have permission to edit items. Please contact an administrator if you need access.
          </p>
          <ContextBackLink
            fallback={getBackDestination()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            Back to Project
          </ContextBackLink>
        </div>
      </div>
    )
  }

  const [formData, setFormData] = useState({
    description: '',
    source: '',
    sku: '',
    purchasePrice: '',
    projectPrice: '',
    marketValue: '',
    paymentMethod: '',
    space: '',
    notes: '',
    selectedTransactionId: ''
  })

  const [isCustomSource, setIsCustomSource] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])
  const [images, setImages] = useState<ItemImage[]>([])
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [projectName, setProjectName] = useState<string>('')
  const offlineMediaIdsRef = useRef<Set<string>>(new Set())

  // Track if user has manually edited project_price
  const projectPriceEditedRef = useRef(false)

  console.log('EditItem - URL params:', { projectId, itemId })

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

  // Initialize custom states based on form data
  useEffect(() => {
    if (formData.source && !availableVendors.includes(formData.source)) {
      setIsCustomSource(true)
    } else if (formData.source && availableVendors.includes(formData.source)) {
      setIsCustomSource(false)
    }
  }, [formData.source, availableVendors])

  // NOTE: Do not auto-fill projectPrice while the user is typing. Defaulting to
  // purchasePrice should happen only when the user saves the item.


  // Load item data
  useEffect(() => {
    const fetchItem = async () => {
      console.log('fetchItem called with:', { projectId, itemId })
      if (itemId && projectId && currentAccountId) {
        try {
          const fetchedItem = await unifiedItemsService.getItemById(currentAccountId, itemId)
          console.log('Fetched item data:', fetchedItem)
          if (fetchedItem) {
            setImages(fetchedItem.images || [])
            setFormData({
              description: String(fetchedItem.description || ''),
              source: String(fetchedItem.source || ''),
              sku: String(fetchedItem.sku || ''),
              purchasePrice: String(fetchedItem.purchasePrice || ''),
              projectPrice: String(fetchedItem.projectPrice || ''),
              marketValue: String(fetchedItem.marketValue || ''),
              paymentMethod: String(fetchedItem.paymentMethod || ''),
              space: String(fetchedItem.space || ''),
              notes: String(fetchedItem.notes || ''),
              selectedTransactionId: String(fetchedItem.transactionId || '')
            })
            console.log('Form data set:', {
              description: String(fetchedItem.description || ''),
              source: String(fetchedItem.source || ''),
              sku: String(fetchedItem.sku || ''),
              purchasePrice: String(fetchedItem.purchasePrice || ''),
              marketValue: String(fetchedItem.marketValue || ''),
              paymentMethod: String(fetchedItem.paymentMethod || ''),
              notes: String(fetchedItem.notes || '')
            })
          }
        } catch (error) {
          console.error('Failed to fetch item:', error)
          setErrors({ fetch: 'Failed to load item data' })
        }
      }
      setLoading(false)
    }

    fetchItem()
  }, [itemId, projectId, currentAccountId])

  useEffect(() => {
    const fetchProjectName = async () => {
      if (!projectId || !currentAccountId) return
      try {
        const project = await projectService.getProject(currentAccountId, projectId)
        if (project) {
          setProjectName(project.name)
        }
      } catch (error) {
        console.error('Failed to load project name:', error)
      }
    }

    fetchProjectName()
  }, [projectId, currentAccountId])

  // Hydrate and fetch transactions when component mounts
  useEffect(() => {
    const fetchTransactions = async () => {
      if (projectId && currentAccountId) {
        setLoadingTransactions(true)
        try {
          // Hydrate cache first to prevent empty state flash
          try {
            const queryClient = getGlobalQueryClient()
            if (queryClient) {
              await hydrateProjectTransactionsCache(queryClient, currentAccountId, projectId)
              // Check if React Query cache has transactions
              const cached = queryClient.getQueryData<Transaction[]>(['project-transactions', currentAccountId, projectId])
              if (cached && cached.length > 0) {
                setTransactions(cached)
              }
            }
          } catch (hydrateError) {
            console.warn('Failed to hydrate transaction cache:', hydrateError)
          }
          
          // Fetch fresh transactions (will update cache)
          const fetchedTransactions = await transactionService.getTransactions(currentAccountId, projectId)
          setTransactions(fetchedTransactions)
        } catch (error) {
          console.error('Error fetching transactions:', error)
        } finally {
          setLoadingTransactions(false)
        }
      }
    }

    fetchTransactions()
  }, [projectId, currentAccountId])

  // Validation function
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.description.trim() && images.length === 0) {
      newErrors.description = 'Add a description or at least one image'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  useEffect(() => {
    if (!errors.description) return
    if (formData.description.trim() || images.length > 0) {
      setErrors(prev => ({ ...prev, description: '' }))
    }
  }, [errors.description, formData.description, images.length])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validateForm() || !itemId || !projectId || !currentAccountId) return

    setSaving(true)

    const itemData = {
      description: formData.description,
      source: formData.source,
      sku: formData.sku,
      purchasePrice: formData.purchasePrice,
      // Default projectPrice to purchasePrice at save time when left blank
      projectPrice: formData.projectPrice || formData.purchasePrice,
      marketValue: formData.marketValue,
      paymentMethod: formData.paymentMethod,
      space: formData.space,
      notes: formData.notes,
      transactionId: formData.selectedTransactionId || undefined,
      lastUpdated: new Date().toISOString()
    }

    try {
      await unifiedItemsService.updateItem(currentAccountId, itemId, itemData)
      if (projectId) {
        const detailPath = projectItemDetail(projectId, itemId)
        const returnTo = projectItems(projectId)
        const detailUrl = `${detailPath}?returnTo=${encodeURIComponent(returnTo)}`
        navigate(detailUrl, { replace: true })
      } else {
        navigateToReturnToOrFallback(navigate, location, fallbackPath)
      }
    } catch (error) {
      console.error('Error updating item:', error)
      console.error('Form data being submitted:', itemData)
      console.error('Item ID:', itemId)
      console.error('Project ID:', projectId)

      // Provide more specific error messages based on error type
      let errorMessage = 'Failed to update item. Please try again.'
      if (error instanceof Error) {
        if (error.message.includes('permission-denied')) {
          errorMessage = 'Permission denied. Please check your access rights.'
        } else if (error.message.includes('not-found')) {
          errorMessage = 'Item not found. It may have been deleted.'
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else {
          errorMessage = `Update failed: ${error.message}`
        }
      }

      setErrors({ submit: errorMessage })
    } finally {
      setSaving(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    console.log('Updating field:', field, 'with value:', value)
    setFormData(prev => {
      const newData = { ...prev, [field]: value }
      console.log('New form data:', newData)
      return newData
    })

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
    setFormData(prev => ({ ...prev, selectedTransactionId: transactionId }))

    // Clear error when user makes selection
    if (errors.selectedTransactionId) {
      setErrors(prev => ({ ...prev, selectedTransactionId: '' }))
    }
  }

  const handleMultipleImageUpload = async (files: File[]) => {
    if (!itemId || !currentAccountId) return

    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })

      const newImages: ItemImage[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const uploadResult = await OfflineAwareImageService.uploadItemImage(
          file,
          projectName || 'Business Inventory',
          itemId,
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

      const updatedImages = [...images, ...newImages]

      await unifiedItemsService.updateItem(currentAccountId, itemId, { images: updatedImages })

      newImages.forEach(img => {
        if (img.metadata?.offlineMediaId) {
          offlineMediaIdsRef.current.delete(img.metadata.offlineMediaId)
        }
      })

      setImages(updatedImages)

      if (!isOnline) {
        console.info('Images saved offline and queued for sync')
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
    try {
      setUploadsInFlight(count => {
        if (count === 0) {
          setUploadProgress(0)
        }
        return count + 1
      })
      const files = await ImageUploadService.selectFromGallery()

      if (files && files.length > 0) {
        await handleMultipleImageUpload(files)
      }
    } catch (error: any) {
      console.error('Error selecting from gallery:', error)

      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        return
      }

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
    if (!itemId || !currentAccountId) return

    try {
      if (imageUrl.startsWith('offline://')) {
        const mediaId = imageUrl.replace('offline://', '')
        offlineMediaIdsRef.current.delete(mediaId)
        try {
          await offlineMediaService.deleteMediaFile(mediaId)
        } catch (error) {
          console.warn('Failed to delete offline media file:', error)
        }
      }

      const updatedImages = images.filter(img => img.url !== imageUrl)
      await unifiedItemsService.updateItem(currentAccountId, itemId, { images: updatedImages })
      setImages(updatedImages)
    } catch (error) {
      console.error('Error removing image:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    }
  }

  const handleSetPrimaryImage = async (imageUrl: string) => {
    if (!itemId || !currentAccountId) return

    try {
      const updatedImages = images.map(img => ({
        ...img,
        isPrimary: img.url === imageUrl
      }))
      await unifiedItemsService.updateItem(currentAccountId, itemId, { images: updatedImages })
      setImages(updatedImages)
    } catch (error) {
      console.error('Error setting primary image:', error)
      const friendlyMessage = getUserFriendlyErrorMessage(error)
      const action = getErrorAction(error)
      showError(`${friendlyMessage} Suggestion: ${action}`)
    }
  }



  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <ContextBackLink
              fallback={getBackDestination()}
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </ContextBackLink>
          </div>
        </div>
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-gray-900">Edit Item</h1>
          </div>
          <div className="p-8">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-300 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-300 rounded w-1/2 mb-4"></div>
              <div className="h-4 bg-gray-300 rounded w-2/3"></div>
            </div>
          </div>
        </div>
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
            fallback={getBackDestination()}
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </ContextBackLink>
          {hasSyncError && <RetrySyncButton size="sm" variant="secondary" />}
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Edit Item</h1>
        </div>
        <div className="px-6 py-4">
          <div className="px-6 py-4">
            <form onSubmit={handleSubmit} className="space-y-8">
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

              {/* Item Images */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-gray-900 flex items-center">
                    <ImagePlus className="h-5 w-5 mr-2" />
                    Item Images
                  </h3>
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={handleSelectFromGallery}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                    title="Add images from gallery or camera"
                  >
                    <ImagePlus className="h-3 w-3 mr-1" />
                    Add Images
                  </button>
                  <UploadActivityIndicator isUploading={isUploadingImage} progress={uploadProgress} className="mt-1" />
                </div>
                </div>

                {images.length > 0 ? (
                  <ImagePreview
                    images={images}
                    onRemoveImage={handleRemoveImage}
                    onSetPrimary={handleSetPrimaryImage}
                    maxImages={5}
                    size="md"
                    showControls={true}
                  />
                ) : (
                  <div className="text-center py-8">
                    <ImagePlus className="mx-auto h-8 w-8 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No images uploaded</h3>
                  </div>
                )}
              </div>

              {/* Transaction Selection */}
              <Combobox
                label="Associate with Transaction (Optional)"
                value={
                  // Guard: if selectedTransactionId is not in options yet, use empty string to avoid uncontrolled/controlled warning
                  formData.selectedTransactionId && transactions.some(tx => tx.transactionId === formData.selectedTransactionId)
                    ? formData.selectedTransactionId
                    : ''
                }
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
              {formData.selectedTransactionId && !transactions.some(tx => tx.transactionId === formData.selectedTransactionId) && !loadingTransactions && (
                <p className="mt-1 text-sm text-amber-600">Selected transaction is loading...</p>
              )}

              {/* Source */}
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

              {/* Payment Method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
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
                <input
                  type="text"
                  id="space"
                  value={formData.space}
                  onChange={(e) => handleInputChange('space', e.target.value)}
                  placeholder="e.g., Living Room, Master Bedroom, Kitchen"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
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
                  fallback={getBackDestination()}
                  className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </ContextBackLink>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Sticky mobile action bar */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50">
          <div className="flex space-x-3">
            <ContextBackLink
              fallback={getBackDestination()}
              className="flex-1 inline-flex justify-center items-center px-4 py-3 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </ContextBackLink>
            <button
              type="submit"
              disabled={saving}
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
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Add bottom padding to account for sticky bar on mobile */}
      <div className="sm:hidden h-20"></div>
    </div>
  )
}
