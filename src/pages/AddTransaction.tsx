import { ArrowLeft, Save, X } from 'lucide-react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { useState, FormEvent, useEffect, useMemo } from 'react'
import { TransactionFormData, TransactionValidationErrors, TransactionItemFormData, ItemImage, TaxPreset, TransactionImage } from '@/types'
import { COMPANY_NAME, CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'
import { transactionService, projectService, unifiedItemsService } from '@/services/inventoryService'
import { ImageUploadService, UploadProgress } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { useOfflineMediaTracker } from '@/hooks/useOfflineMediaTracker'
import { useOfflineFeedback } from '@/utils/offlineUxFeedback'
import { offlineStore } from '@/services/offlineStore'
import ImageUpload from '@/components/ui/ImageUpload'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import TransactionItemsList from '@/components/TransactionItemsList'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { OfflinePrerequisiteBanner, useOfflinePrerequisiteGate } from '@/components/ui/OfflinePrerequisiteBanner'
import { useAuth } from '../contexts/AuthContext'
import { useAccount } from '../contexts/AccountContext'
import { Shield } from 'lucide-react'
import { getTaxPresets } from '@/services/taxPresetsService'
import { getAvailableVendors } from '@/services/vendorDefaultsService'
import { getCachedDefaultCategory, getDefaultCategory } from '@/services/accountPresetsService'
import CategorySelect from '@/components/CategorySelect'
import { projectTransactions } from '@/utils/routes'
import { navigateToReturnToOrFallback } from '@/utils/navigationReturnTo'
import { useNetworkState } from '@/hooks/useNetworkState'
import { getCachedTaxPresets, getCachedVendorDefaults } from '@/services/offlineMetadataService'
import { loadTransactionItemsWithReconcile } from '@/utils/hydrationHelpers'
import { getGlobalQueryClient } from '@/utils/queryClient'

export default function AddTransaction() {
  const { id, projectId: routeProjectId } = useParams<{ id?: string; projectId?: string }>()
  const projectId = routeProjectId || id
  const navigate = useNavigate()
  const location = useLocation()
  const hasSyncError = useSyncError()
  const fallbackPath = useMemo(() => (projectId ? projectTransactions(projectId) : '/projects'), [projectId])

  const { user, isOwner } = useAuth()
  const { currentAccountId } = useAccount()
  const { getBackDestination } = useNavigationContext()
  const offlineGate = useOfflinePrerequisiteGate()
  const { isReady: metadataReady, blockingReason: prereqBlockingReason } = offlineGate
  const { isOnline } = useNetworkState()
  const { showOfflineSaved } = useOfflineFeedback()
  
  // Track offline media IDs for cleanup
  const itemImageTracker = useOfflineMediaTracker()
  const receiptTracker = useOfflineMediaTracker()
  const otherImageTracker = useOfflineMediaTracker()

  // Check if user has permission to add transactions
  // Users must belong to an account (have currentAccountId) or be a system owner
  if (!currentAccountId && !isOwner()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <Shield className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">
            You don't have permission to add transactions. Please contact an administrator if you need access.
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

  const [projectName, setProjectName] = useState<string>('')

  // Fetch project name
  useEffect(() => {
    const fetchProject = async () => {
      if (projectId && currentAccountId) {
        try {
          const project = await projectService.getProject(currentAccountId, projectId)
          if (project) {
            setProjectName(project.name)
          }
        } catch (error) {
          console.error('Failed to fetch project:', error)
        }
      }
    }

    fetchProject()
  }, [projectId, currentAccountId])

  // Load account-wide default category from Postgres account_presets
  useEffect(() => {
    if (!currentAccountId) return
    let cancelled = false

    const loadDefault = async () => {
      try {
        const defaultCategory = isOnline
          ? await getDefaultCategory(currentAccountId)
          : await getCachedDefaultCategory(currentAccountId)

        if (defaultCategory && !cancelled) {
          setFormData(prev => (prev.categoryId ? prev : { ...prev, categoryId: defaultCategory }))
        }
      } catch (err) {
        console.error('Error loading account default category:', err)
      }
    }

    loadDefault()

    return () => {
      cancelled = true
    }
  }, [currentAccountId, isOnline])

  const [formData, setFormData] = useState<TransactionFormData>({
    transactionDate: (() => {
      const today = new Date()
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    })(), // YYYY-MM-DD format
    source: '',
    transactionType: 'Purchase',
    paymentMethod: '',
    amount: '',
    categoryId: '',
    notes: '',
    status: 'completed',
    reimbursementType: '',
    triggerEvent: 'Manual',
    transactionImages: [], // Legacy field for backward compatibility
    receiptImages: [],
    otherImages: [],
    items: []
  })

  // Tax form state
  const [taxRatePreset, setTaxRatePreset] = useState<string | undefined>(undefined)
  const [subtotal, setSubtotal] = useState<string>('')
  const [taxPresets, setTaxPresets] = useState<TaxPreset[]>([])
  const [selectedPresetRate, setSelectedPresetRate] = useState<number | undefined>(undefined)

  const [items, setItems] = useState<TransactionItemFormData[]>([])
  const [imageFilesMap, setImageFilesMap] = useState<Map<string, File[]>>(new Map())

  const [isCustomSource, setIsCustomSource] = useState(false)
  const [availableVendors, setAvailableVendors] = useState<string[]>([])

  // Load vendor defaults on mount
  useEffect(() => {
    if (!currentAccountId) return
    let cancelled = false

    const loadVendors = async () => {
      try {
        if (!isOnline) {
          const cachedSlots = await getCachedVendorDefaults(currentAccountId)
          if (cancelled) return
          if (!cachedSlots) {
            setAvailableVendors([])
            return
          }
          const vendors = cachedSlots.filter((slot): slot is string => Boolean(slot))
          setAvailableVendors(vendors)
          return
        }

        const vendors = await getAvailableVendors(currentAccountId)
        if (!cancelled) {
          setAvailableVendors(vendors)
        }
      } catch (error) {
        console.error('Error loading vendor defaults:', error)
        if (!cancelled) {
          setAvailableVendors([])
        }
      }
    }

    if (!metadataReady && !isOnline) {
      setAvailableVendors([])
      return
    }

    loadVendors()

    return () => {
      cancelled = true
    }
  }, [currentAccountId, isOnline, metadataReady])

  // Initialize custom source state based on initial form data
  useEffect(() => {
    if (formData.source && !availableVendors.includes(formData.source)) {
      setIsCustomSource(true)
    } else if (formData.source && availableVendors.includes(formData.source)) {
      setIsCustomSource(false)
    }
  }, [formData.source, availableVendors])

  // Load tax presets on mount
  useEffect(() => {
    if (!currentAccountId) return
    let cancelled = false

    const loadPresets = async () => {
      try {
        if (!isOnline) {
          const cachedPresets = await getCachedTaxPresets(currentAccountId)
          if (!cancelled) {
            setTaxPresets(cachedPresets)
          }
          return
        }

        const presets = await getTaxPresets(currentAccountId)
        if (!cancelled) {
          setTaxPresets(presets)
        }
      } catch (error) {
        console.error('Error loading tax presets:', error)
        if (!cancelled) {
          setTaxPresets([])
        }
      }
    }

    if (!metadataReady && !isOnline) {
      setTaxPresets([])
      return
    }

    loadPresets()

    return () => {
      cancelled = true
    }
  }, [currentAccountId, isOnline, metadataReady])

  // Update selected preset rate when preset changes
  useEffect(() => {
    if (taxRatePreset && taxRatePreset !== 'Other') {
      const preset = taxPresets.find(p => p.id === taxRatePreset)
      setSelectedPresetRate(preset?.rate)
    } else {
      setSelectedPresetRate(undefined)
    }
  }, [taxRatePreset, taxPresets])

  const [errors, setErrors] = useState<TransactionValidationErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingImages, setIsUploadingImages] = useState(false)
  const submitDisabled = isSubmitting || isUploadingImages || !metadataReady

  // Validation function
  const validateForm = (): boolean => {
    const newErrors: TransactionValidationErrors = {}

    if (!formData.source.trim()) {
      newErrors.source = 'Source is required'
    }

    // Transaction type is optional
    // Payment method is optional

    if (!formData.categoryId?.trim()) {
      newErrors.categoryId = 'Budget category is required'
    }

    if (!formData.amount.trim()) {
      newErrors.amount = 'Amount is required'
    } else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
      newErrors.amount = 'Amount must be a positive number'
    }

    // Tax validation for Other
    if (taxRatePreset === 'Other') {
      if (!subtotal.trim() || isNaN(Number(subtotal)) || Number(subtotal) <= 0) {
        newErrors.general = 'Subtotal must be provided and greater than 0 when Tax Rate Preset is Other.'
      } else if (Number(formData.amount) < Number(subtotal)) {
        newErrors.general = 'Subtotal cannot exceed the total amount.'
      }
    }

    // Items are now optional - no validation required
    // Transaction date is optional

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validateForm() || !projectId || !currentAccountId) return

    if (!metadataReady) {
      setErrors(prev => ({
        ...prev,
        general: prereqBlockingReason || 'Offline prerequisites not ready. Go online and tap Retry sync to continue.'
      }))
      return
    }

    setIsSubmitting(true)

    try {
      // Create transaction data, excluding image File objects from formData since they contain File objects
      const { transactionImages, receiptImages, otherImages, ...formDataWithoutImages } = formData

      if (!user?.id) {
        throw new Error('User must be authenticated to create transactions')
      }

      // Process receipt images to get metadata
      let processedReceiptImages: TransactionImage[] | undefined
      let receiptOfflineMediaIds: string[] = []
      if (receiptImages && receiptImages.length > 0) {
        processedReceiptImages = []
        for (const file of receiptImages) {
          try {
            const uploadResult = await OfflineAwareImageService.uploadReceiptAttachment(
              file,
              projectName,
              '', // No transactionId yet, will be updated during sync
              currentAccountId
            )

            const metadata = uploadResult.url.startsWith('offline://')
              ? {
                  offlineMediaId: uploadResult.url.replace('offline://', ''),
                  isOfflinePlaceholder: true
                }
              : undefined

            if (metadata?.offlineMediaId) {
              receiptTracker.trackMediaId(metadata.offlineMediaId)
              receiptOfflineMediaIds.push(metadata.offlineMediaId)
            }

            processedReceiptImages.push({
              url: uploadResult.url,
              fileName: uploadResult.fileName,
              uploadedAt: new Date(),
              size: uploadResult.size,
              mimeType: uploadResult.mimeType,
              ...(metadata && { metadata })
            } as TransactionImage)
          } catch (uploadError) {
            console.error(`Failed to upload receipt ${file.name}:`, uploadError)
            // Continue with other files
          }
        }
      }

      // Process other images to get metadata
      let processedOtherImages: TransactionImage[] | undefined
      let otherOfflineMediaIds: string[] = []
      if (otherImages && otherImages.length > 0) {
        processedOtherImages = []
        for (const file of otherImages) {
          try {
            const uploadResult = await OfflineAwareImageService.uploadOtherAttachment(
              file,
              projectName,
              '', // No transactionId yet, will be updated during sync
              currentAccountId
            )

            const metadata = uploadResult.url.startsWith('offline://')
              ? {
                  offlineMediaId: uploadResult.url.replace('offline://', ''),
                  isOfflinePlaceholder: true
                }
              : undefined

            if (metadata?.offlineMediaId) {
              otherImageTracker.trackMediaId(metadata.offlineMediaId)
              otherOfflineMediaIds.push(metadata.offlineMediaId)
            }

            processedOtherImages.push({
              url: uploadResult.url,
              fileName: uploadResult.fileName,
              uploadedAt: new Date(),
              size: uploadResult.size,
              mimeType: uploadResult.mimeType,
              ...(metadata && { metadata })
            } as TransactionImage)
          } catch (uploadError) {
            console.error(`Failed to upload other image ${file.name}:`, uploadError)
            // Continue with other files
          }
        }
      }

      const transactionData = {
        ...formDataWithoutImages,
        projectId: projectId,
        projectName: projectName,
        createdBy: user.id,
        taxRatePreset: taxRatePreset ?? null,
        taxRatePct: taxRatePreset ? undefined : 0,
        receiptEmailed: formData.receiptEmailed ?? false,
        subtotal: taxRatePreset === 'Other' ? subtotal : null,
        ...(processedReceiptImages && { receiptImages: processedReceiptImages }),
        ...(processedOtherImages && { otherImages: processedOtherImages })
      }

      console.log('Attempting to create transaction with data:', transactionData)
      console.log('Transaction date value:', transactionData.transactionDate)
      console.log('Transaction date type:', typeof transactionData.transactionDate)
      console.log('Transaction items:', items)

      // Create transaction with items and processed images
      const transactionId = await transactionService.createTransaction(currentAccountId, projectId, transactionData, items)

      // Remove tracked receipt and other image IDs after successful transaction creation
      // This prevents them from being cleaned up by useOfflineMediaTracker on unmount
      receiptOfflineMediaIds.forEach(mediaId => {
        receiptTracker.removeMediaId(mediaId)
      })
      otherOfflineMediaIds.forEach(mediaId => {
        otherImageTracker.removeMediaId(mediaId)
      })

      // Show offline feedback if any images were queued during transaction creation
      if ((receiptOfflineMediaIds.length > 0 || otherOfflineMediaIds.length > 0) && !isOnline) {
        showOfflineSaved()
      }

      // Upload item images with the correct item IDs
      if (imageFilesMap.size > 0 && items.length > 0) {
        try {
          console.log('Starting image upload process...')
          // Get the created items and extract their IDs
          const queryClient = getGlobalQueryClient()
          const createdItems = queryClient
            ? await loadTransactionItemsWithReconcile(queryClient, currentAccountId, transactionId, { projectId })
            : await unifiedItemsService.getItemsForTransaction(currentAccountId, projectId, transactionId)
          const createdItemIds = createdItems.map(item => item.itemId)
          console.log('Created item IDs:', createdItemIds)
          console.log('Form items:', items.map(item => ({ id: item.id, description: item.description })))
          console.log('Image files map keys:', Array.from(imageFilesMap.keys()))

          // Create a mapping from form item index to created item ID
          // We need to match items by their order since they're created in the same order
          // But we also need to match by temp ID from imageFilesMap
          for (let i = 0; i < items.length && i < createdItemIds.length; i++) {
            const formItem = items[i]
            const itemId = createdItemIds[i]
            
            // Try to get image files using the form item's temp ID
            let imageFiles = imageFilesMap.get(formItem.id)
            
            // Fallback: also check if the item has imageFiles directly
            if (!imageFiles && formItem.imageFiles && formItem.imageFiles.length > 0) {
              imageFiles = formItem.imageFiles
            }

            if (imageFiles && imageFiles.length > 0) {
              console.log(`Uploading ${imageFiles.length} images for item ${itemId} (form item ID: ${formItem.id})`)

              // Upload each image file sequentially with offline support
              const uploadedImages: ItemImage[] = []
              for (let fileIndex = 0; fileIndex < imageFiles.length; fileIndex++) {
                const file = imageFiles[fileIndex]
                try {
                  console.log(`Uploading file ${fileIndex + 1}/${imageFiles.length}: ${file.name}`)
                  const uploadResult = await OfflineAwareImageService.uploadItemImage(
                    file,
                    projectName,
                    itemId,
                    currentAccountId
                  )
                  console.log(`Upload successful for ${file.name}:`, uploadResult)
                  console.log(`Upload result URL: ${uploadResult.url}`)

                  const metadata = uploadResult.url.startsWith('offline://')
                    ? {
                        offlineMediaId: uploadResult.url.replace('offline://', ''),
                        isOfflinePlaceholder: true
                      }
                    : undefined

                  if (metadata?.offlineMediaId) {
                    itemImageTracker.trackMediaId(metadata.offlineMediaId)
                  }

                  const uploadedImage: ItemImage = {
                    url: uploadResult.url,
                    alt: file.name,
                    isPrimary: formItem.images?.find(img => img.fileName === file.name)?.isPrimary || (fileIndex === 0),
                    uploadedAt: new Date(),
                    fileName: uploadResult.fileName,
                    size: uploadResult.size,
                    mimeType: uploadResult.mimeType,
                    metadata
                  }
                  console.log('Created ItemImage object:', uploadedImage)
                  uploadedImages.push(uploadedImage)
                } catch (uploadError) {
                  console.error(`Failed to upload ${file.name}:`, uploadError)
                  // Don't add failed uploads
                }
              }

              console.log('All uploads completed, updating item with images:', uploadedImages)

              // Filter out any failed uploads (empty URLs)
              const validImages = uploadedImages.filter(img => img.url && img.url.trim() !== '')
              console.log(`Valid images to save: ${validImages.length}/${uploadedImages.length}`)

              if (validImages.length > 0) {
                // Update the item with the uploaded images
                await unifiedItemsService.updateItem(currentAccountId, itemId, { images: validImages })
                
                // Remove tracked IDs after successful save
                validImages.forEach(img => {
                  if (img.metadata?.offlineMediaId) {
                    itemImageTracker.removeMediaId(img.metadata.offlineMediaId)
                  }
                })
                
                console.log(`Successfully updated item ${itemId} with ${validImages.length} images`)
                
                // Show offline feedback if any images were queued
                if (validImages.some(img => img.metadata?.isOfflinePlaceholder)) {
                  showOfflineSaved()
                }
              }
            }
          }
        } catch (imageError) {
          console.error('Error in image upload process:', imageError)
          // Don't fail the transaction if image upload fails - just log the error
          // The transaction was successfully created, items just won't have images
        }
      }

      navigateToReturnToOrFallback(navigate, location, fallbackPath)
    } catch (error) {
      console.error('Error creating transaction:', error)
      setErrors({ general: error instanceof Error ? error.message : 'Failed to create transaction. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (field: Exclude<keyof TransactionFormData, 'taxRatePreset' | 'subtotal'>, value: string | boolean | File[]) => {
    // Handle categoryId separately since it's not in the original TransactionFormData type exclusion
    if (field === 'categoryId') {
      setFormData(prev => ({ ...prev, categoryId: value as string }))
      if (errors.categoryId) {
        setErrors(prev => ({ ...prev, categoryId: undefined }))
      }
      return
    }
    setFormData(prev => ({ ...prev, [field]: value }))

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  const handleReceiptImagesChange = (files: File[]) => {
    setFormData(prev => ({ ...prev, receiptImages: files }))
    // Clear any existing image errors
    if (errors.receiptImages) {
      setErrors(prev => ({ ...prev, receiptImages: undefined }))
    }
  }

  const handleOtherImagesChange = (files: File[]) => {
    setFormData(prev => ({ ...prev, otherImages: files }))
    // Clear any existing image errors
    if (errors.otherImages) {
      setErrors(prev => ({ ...prev, otherImages: undefined }))
    }
  }

  const handleImageFilesChange = (itemId: string, imageFiles: File[]) => {
    // Update the imageFilesMap
    setImageFilesMap(prev => {
      const newMap = new Map(prev)
      newMap.set(itemId, imageFiles)
      return newMap
    })

    // Also update the item in the items array with the imageFiles
    setItems(prevItems => prevItems.map(item =>
      item.id === itemId
        ? { ...item, imageFiles }
        : item
    ))
  }

  const handleImageUploadProgress = (fileIndex: number, progress: UploadProgress) => {
    // Progress tracking removed to fix TypeScript errors
    console.log(`Upload progress for file ${fileIndex}: ${progress.percentage}%`)
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
          <h1 className="text-2xl font-bold text-gray-900">Add Transaction</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-8 p-8">
          {!metadataReady && (
            <OfflinePrerequisiteBanner className="mb-4" />
          )}
          {/* General Error Display */}
          {errors.general && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{errors.general}</p>
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
                  errors.source ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            )}
            {errors.source && (
              <p className="mt-1 text-sm text-red-600">{errors.source}</p>
            )}
          </div>

          {/* Budget Category */}
          <div>
            <CategorySelect
              value={formData.categoryId}
              onChange={(categoryId) => {
                handleInputChange('categoryId', categoryId)
              }}
              label="Budget Category"
              error={errors.categoryId}
              required
              disabled={!metadataReady}
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
              {/* 'To Inventory' option removed */}
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
            {errors.transactionType && (
              <p className="mt-1 text-sm text-red-600">{errors.transactionType}</p>
            )}
          </div>

          {/* Transaction Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Transaction Method
            </label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="method_client_card"
                  name="paymentMethod"
                  value="Client Card"
                  checked={formData.paymentMethod === 'Client Card'}
                  onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="method_client_card" className="ml-2 block text-sm text-gray-900">
                  Client Card
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="method_1584_card"
                  name="paymentMethod"
                  value={COMPANY_NAME}
                  checked={formData.paymentMethod === COMPANY_NAME}
                  onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="method_1584_card" className="ml-2 block text-sm text-gray-900">
                  {COMPANY_NAME}
                </label>
              </div>
            </div>
            {errors.paymentMethod && (
              <p className="mt-1 text-sm text-red-600">{errors.paymentMethod}</p>
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
            {errors.reimbursementType && (
              <p className="mt-1 text-sm text-red-600">{errors.reimbursementType}</p>
            )}
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
                  errors.amount ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.amount && (
              <p className="mt-1 text-sm text-red-600">{errors.amount}</p>
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
                  name="tax_rate_preset"
                  value=""
                  checked={!taxRatePreset}
                  onChange={() => {
                    setTaxRatePreset(undefined)
                    setSubtotal('')
                  }}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <label htmlFor="tax_preset_none" className="ml-2 block text-sm text-gray-900">
                  No tax (0%)
                </label>
              </div>
              {taxPresets.map((preset) => (
                <div key={preset.id} className="flex items-center">
                  <input
                    type="radio"
                    id={`tax_preset_${preset.id}`}
                    name="tax_rate_preset"
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
                  name="tax_rate_preset"
                  value="Other"
                  checked={taxRatePreset === 'Other'}
                  onChange={(e) => {
                    setTaxRatePreset(e.target.value)
                  }}
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
              onChange={(e) => {
                // Use the date value directly (YYYY-MM-DD format)
                handleInputChange('transactionDate', e.target.value)
              }}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                errors.transactionDate ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {errors.transactionDate && (
              <p className="mt-1 text-sm text-red-600">{errors.transactionDate}</p>
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
                errors.notes ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {errors.notes && (
              <p className="mt-1 text-sm text-red-600">{errors.notes}</p>
            )}
          </div>

          {/* Transaction Items */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Transaction Items</h3>
            <p className="text-sm text-gray-600 mb-4">
              Add the items from your receipt now or later.
            </p>
            <TransactionItemsList
              items={items}
              onItemsChange={(newItems) => {
                setItems(newItems)
                // Clear items error if items are added
                if (errors.items && newItems.length > 0) {
                  setErrors(prev => ({ ...prev, items: undefined }))
                }
              }}
              projectId={projectId}
              projectName={projectName}
              onImageFilesChange={handleImageFilesChange}
            />
            {errors.items && (
              <p className="mt-1 text-sm text-red-600">{errors.items}</p>
            )}
          </div>

          {/* Receipts */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Receipts
            </h3>
            <ImageUpload
              onImagesChange={handleReceiptImagesChange}
              maxImages={5}
              maxFileSize={10}
              acceptedTypes={['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif','application/pdf']}
              disabled={isSubmitting}
              className="mb-2"
            />
            {errors.receiptImages && (
              <p className="mt-1 text-sm text-red-600">{errors.receiptImages}</p>
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

          {/* Other Images */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Other Images
            </h3>
            <ImageUpload
              onImagesChange={handleOtherImagesChange}
              maxImages={5}
              maxFileSize={10}
              disabled={isSubmitting}
              className="mb-2"
            />
            {errors.otherImages && (
              <p className="mt-1 text-sm text-red-600">{errors.otherImages}</p>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-4">
          <ContextBackLink
            fallback={getBackDestination(projectId ? projectTransactions(projectId) : '/projects')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </ContextBackLink>
            <div className="flex flex-col items-end gap-1">
              <button
                type="submit"
                disabled={submitDisabled}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSubmitting ? 'Creating...' : 'Create Transaction'}
              </button>
              <UploadActivityIndicator isUploading={isUploadingImages} label="Uploading images" />
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
