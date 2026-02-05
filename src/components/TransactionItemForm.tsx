import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Camera } from 'lucide-react'
import { TransactionItemFormData, TransactionItemValidationErrors, ItemImage } from '@/types'
import { ImageUploadService } from '@/services/imageService'
import ImagePreview from './ui/ImagePreview'
import UploadActivityIndicator from './ui/UploadActivityIndicator'
import { useToast } from '@/components/ui/ToastContext'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import { useSyncError } from '@/hooks/useSyncError'
import { OfflinePrerequisiteBanner, useOfflinePrerequisiteGate } from './ui/OfflinePrerequisiteBanner'

interface TransactionItemFormProps {
  item?: TransactionItemFormData
  onSave: (item: TransactionItemFormData) => void
  onCancel: () => void
  isEditing?: boolean
  projectId?: string
  projectName?: string
  onImageFilesChange?: (itemId: string, imageFiles: File[]) => void
}

export default function TransactionItemForm({ item, onSave, onCancel, isEditing = false, onImageFilesChange }: TransactionItemFormProps) {
  const hasSyncError = useSyncError()
  // Check offline prerequisites
  const { isReady, isBlocked, blockingReason } = useOfflinePrerequisiteGate()
  
  // Generate a stable temporary ID that doesn't change during component lifetime
  const stableTempId = useMemo(() =>
    item?.id || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    [item?.id]
  )
  const descriptionInputId = `transaction-item-${stableTempId}-description`
  const skuInputId = `transaction-item-${stableTempId}-sku`
  const purchasePriceInputId = `transaction-item-${stableTempId}-purchasePrice`
  const projectPriceInputId = `transaction-item-${stableTempId}-projectPrice`
  const marketValueInputId = `transaction-item-${stableTempId}-marketValue`
  const spaceInputId = `transaction-item-${stableTempId}-space`
  const notesInputId = `transaction-item-${stableTempId}-notes`

  const buildFormData = (source?: TransactionItemFormData): TransactionItemFormData => ({
    id: source?.id || stableTempId,
    description: source?.description ?? '',
    sku: source?.sku ?? '',
    purchasePrice: source?.purchasePrice ?? '',
    projectPrice: source?.projectPrice ?? '',
    marketValue: source?.marketValue ?? '',
    space: source?.space ?? '',
    notes: source?.notes ?? '',
    disposition: source?.disposition ?? 'purchased',
    taxAmountPurchasePrice: source?.taxAmountPurchasePrice ?? '',
    taxAmountProjectPrice: source?.taxAmountProjectPrice ?? ''
  })

  const [formData, setFormData] = useState<TransactionItemFormData>(() => buildFormData(item))

  const [itemImages, setItemImages] = useState<ItemImage[]>(item?.images || [])
  const [imageFiles, setImageFiles] = useState<File[]>(item?.imageFiles || [])
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [isImageDragOver, setIsImageDragOver] = useState(false)

  const [errors, setErrors] = useState<TransactionItemValidationErrors>({})
  const unsavedPreviewUrlsRef = useRef<Set<string>>(new Set())
  const { showError } = useToast()

  useEffect(() => {
    if (!errors.description) return
    const hasRequiredContent = Boolean(formData.description.trim() || itemImages.length > 0 || imageFiles.length > 0)
    if (hasRequiredContent) {
      setErrors(prev => ({ ...prev, description: undefined }))
    }
  }, [errors.description, formData.description, itemImages.length, imageFiles.length])

  const trackUnsavedPreviewUrl = (url: string) => {
    unsavedPreviewUrlsRef.current.add(url)
  }

  const releaseUnsavedPreviewUrl = (url?: string) => {
    if (!url) return
    if (!unsavedPreviewUrlsRef.current.has(url)) return
    ImageUploadService.revokePreviewUrl(url)
    unsavedPreviewUrlsRef.current.delete(url)
  }

  // Update state when item prop changes (for editing existing items)
  useEffect(() => {
    unsavedPreviewUrlsRef.current.forEach(url => ImageUploadService.revokePreviewUrl(url))
    unsavedPreviewUrlsRef.current.clear()

    if (item) {
      console.log('TransactionItemForm: Editing item with images:', item.images?.length || 0, 'imageFiles:', item.imageFiles?.length || 0)
      setItemImages(item.images || [])
      setImageFiles(item.imageFiles || [])
      setFormData(buildFormData(item))
    } else {
      setItemImages([])
      setImageFiles([])
      setFormData(buildFormData())
    }
  }, [item])

  useEffect(() => {
    return () => {
      unsavedPreviewUrlsRef.current.forEach(url => ImageUploadService.revokePreviewUrl(url))
      unsavedPreviewUrlsRef.current.clear()
    }
  }, [])


  const addImageFiles = async (files: File[]) => {
    if (!files.length) return

    try {
      setUploadsInFlight(count => count + 1)
      const validFiles = files.filter(file => ImageUploadService.validateImageFile(file))
      const invalidCount = files.length - validFiles.length

      if (invalidCount > 0) {
        showError('Some files were skipped. Only image files under 10MB are supported.')
      }

      if (validFiles.length === 0) {
        return
      }

      // Filter out files that are already selected (by name and size)
      const existingFileNames = new Set(imageFiles.map(f => `${f.name}_${f.size}`))
      const newFiles = validFiles.filter(file => !existingFileNames.has(`${file.name}_${file.size}`))

      if (newFiles.length > 0) {
        // Store the files for later upload when the transaction is submitted
        setImageFiles(prev => [...prev, ...newFiles])

        const baseImageCount = itemImages.length

        const previewImages: ItemImage[] = newFiles.map((file, index) => {
          let previewUrl: string
          try {
            previewUrl = ImageUploadService.createPreviewUrl(file)
            trackUnsavedPreviewUrl(previewUrl)
          } catch (error) {
            console.warn('Failed to create preview URL, falling back to placeholder key', error)
            previewUrl = `preview_${file.name}_${file.size}_${Date.now()}_${index}`
          }

          return {
            url: previewUrl,
            alt: file.name,
            isPrimary: baseImageCount === 0 && index === 0,
            uploadedAt: new Date(),
            fileName: file.name,
            size: file.size,
            mimeType: file.type
          }
        })

        setItemImages(prev => [...prev, ...previewImages])
        console.log('Added', previewImages.length, 'new preview images')
      } else {
        console.log('All selected files are already present')
      }
    } finally {
      setUploadsInFlight(count => Math.max(0, count - 1))
    }
  }

  const handleSelectFromGallery = async () => {
    try {
      const files = await ImageUploadService.selectFromGallery()

      if (files && files.length > 0) {
        console.log('Selected', files.length, 'files from gallery')
        await addImageFiles(files)
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
      showError('Failed to select images from gallery. Please try again.')
    }
  }

  const handleImageDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!isUploadingImage) {
      setIsImageDragOver(true)
    }
  }

  const handleImageDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsImageDragOver(false)
  }

  const handleImageDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsImageDragOver(false)

    if (isUploadingImage) return

    const droppedFiles = Array.from(event.dataTransfer.files || [])
    if (droppedFiles.length === 0) return

    await addImageFiles(droppedFiles)
  }

  const handleRemoveImage = (imageUrl: string) => {
    const imageIndex = itemImages.findIndex(img => img.url === imageUrl)
    if (imageIndex !== -1 && imageIndex < imageFiles.length) {
      // Remove both the image and the corresponding file
      setItemImages(prev => prev.filter(img => img.url !== imageUrl))
      setImageFiles(prev => prev.filter((_, index) => index !== imageIndex))
    } else {
      setItemImages(prev => prev.filter(img => img.url !== imageUrl))
    }
    releaseUnsavedPreviewUrl(imageUrl)
  }

  const handleSetPrimaryImage = (imageUrl: string) => {
    setItemImages(prev => prev.map(img => ({
      ...img,
      isPrimary: img.url === imageUrl
    })))
  }

  const validateForm = (): boolean => {
    const newErrors: TransactionItemValidationErrors = {}

    if (!formData.description.trim() && itemImages.length === 0 && imageFiles.length === 0) {
      newErrors.description = 'Add a description or at least one image'
    }

    if (formData.purchasePrice && (isNaN(Number(formData.purchasePrice)) || Number(formData.purchasePrice) <= 0)) {
      newErrors.purchasePrice = 'Purchase price must be a positive number'
    }
    if (formData.projectPrice && (isNaN(Number(formData.projectPrice)) || Number(formData.projectPrice) <= 0)) {
      newErrors.projectPrice = 'Project price must be a positive number'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validateForm()) return
    
    // Block submission if offline prerequisites are not ready
    if (!isReady) {
      showError(blockingReason || 'Offline prerequisites not ready. Please sync metadata before saving.')
      return
    }

    // Include images and files in the form data
    const itemWithImages = {
      ...formData,
      images: itemImages,
      imageFiles: imageFiles // Include the actual files for upload
    }

    // Notify parent about image files if callback exists
    if (onImageFilesChange && imageFiles.length > 0) {
      onImageFilesChange(stableTempId, imageFiles)
    }

    unsavedPreviewUrlsRef.current.clear()
    onSave(itemWithImages)
  }

  const handleInputChange = (field: keyof TransactionItemFormData, value: string) => {
    // For price-related fields, ensure they are valid numbers or empty
    if (field === 'purchasePrice' || field === 'projectPrice') {
      if (value !== '' && (isNaN(Number(value)) || Number(value) < 0)) {
        return // Don't update if invalid
      }
    }
    setFormData(prev => ({ ...prev, [field]: value }))

    // Clear error when user starts typing
    if (errors[field as keyof TransactionItemValidationErrors]) {
      setErrors(prev => ({ ...prev, [field]: undefined } as TransactionItemValidationErrors))
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">
            {isEditing ? 'Edit Item' : 'Add Item'}
          </h3>
          {!isEditing && (
            <p className="mt-1 text-sm text-gray-600">Add a description or at least one image to create an item.</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasSyncError && <RetrySyncButton size="sm" variant="secondary" showPendingCount={false} />}
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Offline Prerequisites Banner */}
        {!isReady && (
          <OfflinePrerequisiteBanner className="mb-4" />
        )}

        {/* Item Images */}
        <div
          onDragOver={handleImageDragOver}
          onDragLeave={handleImageDragLeave}
          onDrop={handleImageDrop}
          className={`rounded-lg border border-transparent p-2 transition ${
            isImageDragOver ? 'border-primary-300 bg-primary-50' : ''
          }`}
          aria-label="Item images drop zone"
        >
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Item Images
          </label>

          {/* Image upload button */}
          <div className="flex flex-col items-start gap-1 mb-3">
            <button
              type="button"
              onClick={handleSelectFromGallery}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              title="Add images from gallery or camera"
            >
              <Camera className="h-4 w-4 mr-2" />
              Add Images
            </button>
            <UploadActivityIndicator isUploading={isUploadingImage} className="mt-1" />
          </div>

          {/* Image preview */}
          <ImagePreview
            images={itemImages}
            onRemoveImage={handleRemoveImage}
            onSetPrimary={handleSetPrimaryImage}
            maxImages={3}
            size="md"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor={descriptionInputId} className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <input
            type="text"
            id={descriptionInputId}
            name={`transaction_item_description_${stableTempId}`}
            autoComplete="off"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            placeholder="Item description"
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
              errors.description ? 'border-red-300' : 'border-gray-300'
            }`}
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description}</p>
          )}
        </div>

        {/* SKU */}
        <div>
          <label htmlFor={skuInputId} className="block text-sm font-medium text-gray-700">
            SKU
          </label>
          <input
            type="text"
            id={skuInputId}
            name={`transaction_item_sku_${stableTempId}`}
            autoComplete="off"
            value={formData.sku}
            onChange={(e) => handleInputChange('sku', e.target.value)}
            placeholder="Stock keeping unit"
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
              errors.sku ? 'border-red-300' : 'border-gray-300'
            }`}
          />
          {errors.sku && (
            <p className="mt-1 text-sm text-red-600">{errors.sku}</p>
          )}
        </div>

        {/* Purchase Price */}
        <div>
          <label htmlFor={purchasePriceInputId} className="block text-sm font-medium text-gray-700">
            Purchase Price
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              id={purchasePriceInputId}
              name={`transaction_item_purchasePrice_${stableTempId}`}
              autoComplete="off"
              value={formData.purchasePrice || ''}
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
          <label htmlFor={projectPriceInputId} className="block text-sm font-medium text-gray-700">
            Project Price
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              id={projectPriceInputId}
              name={`transaction_item_projectPrice_${stableTempId}`}
              autoComplete="off"
              value={formData.projectPrice || ''}
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
          <label htmlFor={marketValueInputId} className="block text-sm font-medium text-gray-700">
            Market Value
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="text"
              id={marketValueInputId}
              name={`transaction_item_marketValue_${stableTempId}`}
              autoComplete="off"
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
          <label htmlFor={spaceInputId} className="block text-sm font-medium text-gray-700">
            Space
          </label>
          <input
            type="text"
            id={spaceInputId}
            name={`transaction_item_space_${stableTempId}`}
            autoComplete="off"
            value={formData.space}
            onChange={(e) => handleInputChange('space', e.target.value)}
            placeholder="e.g., Living Room, Master Bedroom, Kitchen"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor={notesInputId} className="block text-sm font-medium text-gray-700">
            Notes
          </label>
          <textarea
            id={notesInputId}
            name={`transaction_item_notes_${stableTempId}`}
            autoComplete="off"
            rows={2}
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            placeholder="Additional notes about this item"
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
              errors.notes ? 'border-red-300' : 'border-gray-300'
            }`}
          />
          {errors.notes && (
            <p className="mt-1 text-sm text-red-600">{errors.notes}</p>
          )}
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onCancel()
            }}
            className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleSubmit()
            }}
            disabled={!isReady}
            className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEditing ? 'Update Item' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}
