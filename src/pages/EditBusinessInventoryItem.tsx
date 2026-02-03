import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { ArrowLeft, ImagePlus, Save, X } from 'lucide-react'
import { Item } from '@/types'
import { unifiedItemsService } from '@/services/inventoryService'
import { useAccount } from '@/contexts/AccountContext'
import { Combobox } from '@/components/ui/Combobox'
import { RetrySyncButton } from '@/components/ui/RetrySyncButton'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { useSyncError } from '@/hooks/useSyncError'
import { useBusinessInventoryRealtime } from '@/contexts/BusinessInventoryRealtimeContext'
import ImagePreview from '@/components/ui/ImagePreview'
import { ImageUploadService } from '@/services/imageService'
import SpeechMicButton from '@/components/ui/SpeechMicButton'

export default function EditBusinessInventoryItem() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const hasSyncError = useSyncError()
  const location = useLocation()
  const { currentAccountId } = useAccount()
  const { refreshCollections } = useBusinessInventoryRealtime()
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [item, setItem] = useState<Item | null>(null)
  const [uploadsInFlight, setUploadsInFlight] = useState(0)
  const isUploadingImage = uploadsInFlight > 0
  const [uploadProgress, setUploadProgress] = useState<number>(0)

  // Track if user has manually edited project_price
  const projectPriceEditedRef = useRef(false)

  const [formData, setFormData] = useState<{
    description: string;
    source: string;
    sku: string;
    purchasePrice: string;
    projectPrice: string;
    marketValue: string;
    disposition: string;
    notes: string;
    bookmark: boolean;
    businessInventoryLocation: string;
    inventoryStatus: 'available' | 'allocated' | 'sold' | undefined;
  }>({
    description: '',
    source: '',
    sku: '',
    purchasePrice: '',
    projectPrice: '',
    marketValue: '',
    disposition: 'inventory',
    notes: '',
    bookmark: false,
    businessInventoryLocation: '',
    inventoryStatus: 'available' as 'available' | 'allocated' | 'sold' | undefined
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Navigation context logic
  const backDestination = useMemo(() => {
    // Check if we have a returnTo parameter
    const searchParams = new URLSearchParams(location.search)
    const returnTo = searchParams.get('returnTo')
    if (returnTo) return returnTo

    // Default fallback
    return '/business-inventory'
  }, [location.search])

  useEffect(() => {
    if (id && currentAccountId) {
      loadItem()
    }
  }, [id, currentAccountId])

  // NOTE: Do not auto-fill projectPrice while the user is typing. Defaulting to
  // purchasePrice should happen only when the user saves the item.

  const loadItem = async () => {
    if (!id || !currentAccountId) return

    try {
      const itemData = await unifiedItemsService.getItemById(currentAccountId, id)
      if (itemData) {
        setItem(itemData)
        setFormData({
          description: itemData.description,
          source: itemData.source,
          sku: itemData.sku,
          purchasePrice: itemData.purchasePrice || '',
          projectPrice: itemData.projectPrice || '',
          marketValue: itemData.marketValue || '',
          disposition: itemData.disposition === 'keep' ? 'purchased' : (itemData.disposition || 'inventory'),
          notes: itemData.notes || '',
          bookmark: itemData.bookmark,
          businessInventoryLocation: itemData.businessInventoryLocation || '',
          inventoryStatus: itemData.inventoryStatus
        })
      }
    } catch (error) {
      console.error('Error loading item:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: keyof typeof formData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Mark projectPrice as manually edited if user is editing it
    if (field === 'projectPrice') {
      projectPriceEditedRef.current = true
    }

    // Clear error when user starts typing
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const validateForm = () => {
    const errors: Record<string, string> = {}

    if (!formData.description.trim() && !(item?.images && item.images.length > 0)) {
      errors.description = 'Add a description or at least one image'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  useEffect(() => {
    if (!formErrors.description) return
    if (formData.description.trim() || (item?.images && item.images.length > 0)) {
      setFormErrors(prev => ({ ...prev, description: '' }))
    }
  }, [formErrors.description, formData.description, item?.images])

  const handleSelectFromGallery = async () => {
    if (!item || !item.itemId) return

    try {
    setUploadsInFlight(count => {
      if (count === 0) {
        setUploadProgress(0)
      }
      return count + 1
    })
      setUploadProgress(0)

      const files = await ImageUploadService.selectFromGallery()

      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          await processImageUpload(file)
        }
      }
    } catch (error: any) {
      console.error('Error selecting from gallery:', error)

      if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
        return
      }

      alert('Failed to add images. Please try again.')
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

  const processImageUpload = async (file: File) => {
    if (!item?.itemId || !currentAccountId) return

    const uploadResult = await ImageUploadService.uploadItemImage(
      file,
      'Business Inventory',
      item.itemId
    )

    const newImage = {
      url: uploadResult.url,
      alt: file.name,
      isPrimary: item.images?.length === 0,
      uploadedAt: new Date(),
      fileName: file.name,
      size: file.size,
      mimeType: file.type
    }

    const currentImages = item.images || []
    const updatedImages = [...currentImages, newImage]

    await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })
    setItem({ ...item, images: updatedImages })
    await refreshCollections()
  }

  const handleRemoveImage = async (imageUrl: string) => {
    if (!item?.itemId || !currentAccountId) return

    try {
      const updatedImages = item.images?.filter(img => img.url !== imageUrl) || []
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })
      setItem({ ...item, images: updatedImages })
      await refreshCollections()
    } catch (error) {
      console.error('Error removing image:', error)
      alert('Error removing image. Please try again.')
    }
  }

  const handleSetPrimaryImage = async (imageUrl: string) => {
    if (!item?.itemId || !currentAccountId) return

    try {
      const updatedImages = item.images?.map(img => ({
        ...img,
        isPrimary: img.url === imageUrl
      })) || []
      await unifiedItemsService.updateItem(currentAccountId, item.itemId, { images: updatedImages })
      setItem({ ...item, images: updatedImages })
      await refreshCollections()
    } catch (error) {
      console.error('Error setting primary image:', error)
      alert('Error setting primary image. Please try again.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!id || !validateForm() || !currentAccountId) {
      return
    }

    setIsSubmitting(true)

    try {
      // Default projectPrice to purchasePrice only at save time when projectPrice
      // was left blank by the user.
      const payload = { ...formData }
      if (!payload.projectPrice && payload.purchasePrice) {
        payload.projectPrice = payload.purchasePrice
      }

      await unifiedItemsService.updateItem(currentAccountId, id, payload)
      try {
        await refreshCollections()
      } catch (error) {
        console.debug('EditBusinessInventoryItem: realtime refresh failed', error)
      }
      navigate(`/business-inventory/${id}`, { replace: true })
    } catch (error) {
      console.error('Error updating item:', error)
      setFormErrors({ general: 'Error updating item. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }


  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!item) {
    return (
        <div className="text-center py-12 px-4">
        <div className="mx-auto h-16 w-16 text-gray-400 -mb-1">📦</div>
        <h3 className="text-lg font-medium text-gray-900 mb-1">
          Item not found
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          The item you're looking for doesn't exist or has been deleted.
        </p>
        <ContextBackLink
            fallback={backDestination}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
        >
          Back to Inventory
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

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Edit Item</h1>
        </div>
        <div className="px-6 py-4">
          <form onSubmit={handleSubmit} className="space-y-8">
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
                  placeholder="e.g., CHR-001"
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
                  placeholder="e.g., Vintage leather armchair"
                  className={`block w-full px-3 py-2 pr-12 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                    formErrors.description ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                <SpeechMicButton
                  value={formData.description}
                  onChangeText={(next) => handleInputChange('description', next)}
                  label="Description"
                  append={true}
                />
              </div>
              {formErrors.description && (
                <p className="mt-1 text-sm text-red-600">{formErrors.description}</p>
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

              {item?.images && item.images.length > 0 ? (
                <ImagePreview
                  images={item.images}
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

            {/* Source */}
            <div>
              <label htmlFor="source" className="block text-sm font-medium text-gray-700">
                Source
              </label>
              <input
                type="text"
                id="source"
                value={formData.source}
                onChange={(e) => handleInputChange('source', e.target.value)}
                placeholder="e.g., purchased, found, donated"
                className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  formErrors.source ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              {formErrors.source && (
                <p className="mt-1 text-sm text-red-600">{formErrors.source}</p>
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
                  inputMode="decimal"
                  id="purchasePrice"
                  value={formData.purchasePrice}
                  onChange={(e) => handleInputChange('purchasePrice', e.target.value)}
                  placeholder="0.00"
                  className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                    formErrors.purchasePrice ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
              </div>
              {formErrors.purchasePrice && (
                <p className="mt-1 text-sm text-red-600">{formErrors.purchasePrice}</p>
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
                inputMode="decimal"
                id="projectPrice"
                value={formData.projectPrice}
                onChange={(e) => handleInputChange('projectPrice', e.target.value)}
                placeholder="0.00"
                className={`block w-full pl-8 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                  formErrors.projectPrice ? 'border-red-300' : 'border-gray-300'
                }`}
              />
            </div>
            {formErrors.projectPrice && (
              <p className="mt-1 text-sm text-red-600">{formErrors.projectPrice}</p>
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
                  inputMode="decimal"
                  id="marketValue"
                  value={formData.marketValue}
                  onChange={(e) => handleInputChange('marketValue', e.target.value)}
                  placeholder="0.00"
                  className="mt-1 block w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Storage Location */}
            <div>
              <label htmlFor="businessInventoryLocation" className="block text-sm font-medium text-gray-700">
                Storage Location
              </label>
              <div className="mt-1 relative">
                <input
                  type="text"
                  id="businessInventoryLocation"
                  value={formData.businessInventoryLocation}
                  onChange={(e) => handleInputChange('businessInventoryLocation', e.target.value)}
                  placeholder="e.g., Warehouse A - Section 3 - Shelf 5"
                  className={`block w-full px-3 py-2 pr-12 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 ${
                    formErrors.businessInventoryLocation ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                <SpeechMicButton
                  value={formData.businessInventoryLocation}
                  onChangeText={(next) => handleInputChange('businessInventoryLocation', next)}
                  label="Storage Location"
                  append={false}
                />
              </div>
              {formErrors.businessInventoryLocation && (
                <p className="mt-1 text-sm text-red-600">{formErrors.businessInventoryLocation}</p>
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

            {/* Inventory Status */}
            <div>
              <label htmlFor="inventoryStatus" className="block text-sm font-medium text-gray-700">
                Inventory Status
              </label>
              <Combobox
                value={formData.inventoryStatus}
                onChange={(value) => handleInputChange('inventoryStatus', value)}
                placeholder="Select inventory status"
                options={[
                  { id: 'available', label: 'Available' },
                  { id: 'allocated', label: 'Allocated' },
                  { id: 'sold', label: 'Sold' }
                ]}
              />
              {item.projectId && (
                <div className="mt-4 p-4 bg-yellow-50 rounded-md">
                  <p className="text-sm text-yellow-800">
                    <strong>Note:</strong> This item is currently allocated to project {item.projectId}.
                    Changing the status may affect the pending transaction.
                  </p>
                </div>
              )}
            </div>

            {/* Bookmark */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="bookmark"
                checked={formData.bookmark}
                onChange={(e) => handleInputChange('bookmark', e.target.checked)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="bookmark" className="ml-2 block text-sm text-gray-700">
                Bookmark this item
              </label>
            </div>

            {/* Error message */}
            {formErrors.general && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-600">{formErrors.general}</p>
              </div>
            )}

            {/* Form Actions - Desktop */}
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
                {isSubmitting ? 'Updating Item...' : 'Update Item'}
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
              {isSubmitting ? 'Updating...' : 'Update'}
            </button>
          </div>
        </div>
      </div>

      {/* Add bottom padding to account for sticky bar on mobile */}
      <div className="sm:hidden h-20"></div>
    </div>
  )
}
