import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ArrowLeft, Edit, Trash2, ImagePlus, Save, MoreVertical } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { Space, Item, ItemImage, Project, TransactionItemFormData } from '@/types'
import { spaceService } from '@/services/spaceService'
import { spaceTemplatesService } from '@/services/spaceTemplatesService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { ImageUploadService } from '@/services/imageService'
import ImagePreview from '@/components/ui/ImagePreview'
import UploadActivityIndicator from '@/components/ui/UploadActivityIndicator'
import { useToast } from '@/components/ui/ToastContext'
import { useAccount } from '@/contexts/AccountContext'
import { projectService, unifiedItemsService } from '@/services/inventoryService'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { projectSpaces } from '@/utils/routes'
import TransactionItemsList from '@/components/TransactionItemsList'
import SpaceItemPicker from '@/components/spaces/SpaceItemPicker'
import { mapItemToTransactionItemFormData, mapTransactionItemFormDataToItemUpdate } from '@/utils/spaceItemFormMapping'

export default function SpaceDetail() {
  const { projectId, spaceId } = useParams<{ projectId: string; spaceId: string }>()
  const navigate = useNavigate()
  const { currentAccountId, isAdmin } = useAccount()
  const { buildContextUrl, getBackDestination } = useNavigationContext()
  const { showError, showSuccess } = useToast()

  const [space, setSpace] = useState<Space | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [associatedItems, setAssociatedItems] = useState<Item[]>([])
  const [spaceItems, setSpaceItems] = useState<TransactionItemFormData[]>([])
  const [imageFilesMap, setImageFilesMap] = useState<Map<string, File[]>>(new Map())
  const [showExistingItemsModal, setShowExistingItemsModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedNotes, setEditedNotes] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [showSaveAsTemplateModal, setShowSaveAsTemplateModal] = useState(false)
  const [templateFormData, setTemplateFormData] = useState({ name: '', notes: '' })
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)

  const backDestination = useMemo(() => {
    const defaultPath = projectId ? projectSpaces(projectId) : '/projects'
    return getBackDestination(defaultPath)
  }, [projectId, getBackDestination])

  const fetchSpace = useCallback(async () => {
    if (!currentAccountId || !spaceId) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const [fetchedSpace, fetchedProject, fetchedItems] = await Promise.all([
        spaceService.getSpace(currentAccountId, spaceId),
        projectId ? projectService.getProject(currentAccountId, projectId) : Promise.resolve(null),
        projectId
          ? unifiedItemsService.getItemsByProjectAndSpace(currentAccountId, projectId, spaceId)
          : Promise.resolve([]),
      ])

      setProject(fetchedProject ?? null)
      setAssociatedItems(fetchedItems ?? [])

      if (fetchedSpace) {
        setSpace(fetchedSpace)
        setEditedName(fetchedSpace.name)
        setEditedNotes(fetchedSpace.notes || '')
        // Prefill template form with space data
        setTemplateFormData({
          name: fetchedSpace.name,
          notes: fetchedSpace.notes || '',
        })
      } else {
        showError('Space not found')
        navigate(buildContextUrl(projectSpaces(projectId!)))
      }
    } catch (error) {
      console.error('Error fetching space:', error)
      showError('Failed to load space')
    } finally {
      setIsLoading(false)
    }
  }, [currentAccountId, spaceId, projectId, navigate, buildContextUrl, showError])

  useEffect(() => {
    fetchSpace()
  }, [fetchSpace])

  useEffect(() => {
    const spaceName = space?.name
    setSpaceItems(associatedItems.map(item => mapItemToTransactionItemFormData(item, { spaceName })))
  }, [associatedItems, space?.name])

  // Close actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setShowActionsMenu(false)
      }
    }

    if (showActionsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showActionsMenu])

  const handleImageFilesChange = (itemId: string, imageFiles: File[]) => {
    setImageFilesMap(prev => {
      const next = new Map(prev)
      next.set(itemId, imageFiles)
      return next
    })
  }

  const uploadItemImages = async (targetItemId: string, sourceItem: TransactionItemFormData) => {
    if (!currentAccountId) return
    const imageFiles = imageFilesMap.get(sourceItem.id) ?? sourceItem.imageFiles
    if (!imageFiles || imageFiles.length === 0) return

    try {
      const uploadedImages: ItemImage[] = []
      const projectName = project?.name ?? 'Unknown Project'

      for (let i = 0; i < imageFiles.length; i += 1) {
        const file = imageFiles[i]
        try {
          const uploadResult = await OfflineAwareImageService.uploadItemImage(
            file,
            projectName,
            targetItemId,
            currentAccountId
          )

          const metadata = uploadResult.url.startsWith('offline://')
            ? {
                offlineMediaId: uploadResult.url.replace('offline://', ''),
                isOfflinePlaceholder: true
              }
            : undefined

          uploadedImages.push({
            url: uploadResult.url,
            alt: file.name,
            isPrimary: i === 0,
            uploadedAt: new Date(),
            fileName: uploadResult.fileName,
            size: uploadResult.size,
            mimeType: uploadResult.mimeType,
            metadata
          })
        } catch (uploadError) {
          console.error(`SpaceDetail: failed to upload ${file.name}`, uploadError)
        }
      }

      if (uploadedImages.length > 0) {
        await unifiedItemsService.updateItem(currentAccountId, targetItemId, { images: uploadedImages })
      }
    } finally {
      setImageFilesMap(prev => {
        if (!prev.has(sourceItem.id)) return prev
        const next = new Map(prev)
        next.delete(sourceItem.id)
        return next
      })
    }
  }

  const handleCreateSpaceItem = async (item: TransactionItemFormData) => {
    if (!currentAccountId || !projectId || !spaceId) return

    try {
      const now = new Date()
      const payload: any = {
        description: item.description,
        sku: item.sku || '',
        purchasePrice: item.purchasePrice || '',
        // Default projectPrice to purchasePrice (matches AddItem behavior)
        projectPrice: item.projectPrice || item.purchasePrice || '',
        marketValue: item.marketValue || '',
        notes: item.notes || '',
        source: project?.name || 'Manual',
        paymentMethod: 'Unknown',
        qrKey: `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        bookmark: false,
        projectId,
        transactionId: item.transactionId ?? null,
        dateCreated: now.toISOString(),
        lastUpdated: now.toISOString(),
        disposition: item.disposition ?? 'purchased',
        spaceId,
        space: space?.name || '',
        taxAmountPurchasePrice: item.taxAmountPurchasePrice,
        taxAmountProjectPrice: item.taxAmountProjectPrice
      }

      const createResult = await unifiedItemsService.createItem(currentAccountId, payload)
      await uploadItemImages(createResult.itemId, item)
      await fetchSpace()
      showSuccess('Item added')
    } catch (error) {
      console.error('SpaceDetail: failed to create item', error)
      showError('Failed to add item')
    }
  }

  const handleUpdateSpaceItem = async (item: TransactionItemFormData) => {
    if (!currentAccountId || !spaceId) return

    try {
      const update = {
        ...mapTransactionItemFormDataToItemUpdate(item),
        spaceId
      }
      await unifiedItemsService.updateItem(currentAccountId, item.id, update)
      await uploadItemImages(item.id, item)
      await fetchSpace()
      showSuccess('Item updated')
    } catch (error) {
      console.error('SpaceDetail: failed to update item', error)
      showError('Failed to update item')
    }
  }

  const handleDuplicateSpaceItem = async (item: TransactionItemFormData, quantity = 1) => {
    if (!currentAccountId || !projectId || !spaceId) return

    try {
      const duplicateCount = Math.max(0, Math.floor(quantity))
      if (duplicateCount === 0) return

      for (let i = 0; i < duplicateCount; i += 1) {
        const now = new Date()
        const payload: any = {
          description: item.description,
          sku: item.sku || '',
          purchasePrice: item.purchasePrice || '',
          projectPrice: item.projectPrice || item.purchasePrice || '',
          marketValue: item.marketValue || '',
          notes: item.notes || '',
          source: project?.name || 'Manual',
          paymentMethod: 'Unknown',
          qrKey: `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          bookmark: false,
          projectId,
          transactionId: item.transactionId ?? null,
          dateCreated: now.toISOString(),
          lastUpdated: now.toISOString(),
          disposition: item.disposition ?? 'purchased',
          spaceId,
          space: space?.name || '',
          images: item.images,
          taxAmountPurchasePrice: item.taxAmountPurchasePrice,
          taxAmountProjectPrice: item.taxAmountProjectPrice
        }
        await unifiedItemsService.createItem(currentAccountId, payload)
      }

      await fetchSpace()
      showSuccess(duplicateCount === 1 ? 'Item duplicated' : `Duplicated ${duplicateCount} items`)
    } catch (error) {
      console.error('SpaceDetail: failed to duplicate item', error)
      showError('Failed to duplicate item')
    }
  }

  const bulkUnassignSpace = async (selectedIds: string[]) => {
    if (!currentAccountId) return
    await Promise.all(selectedIds.map(itemId => unifiedItemsService.updateItem(currentAccountId, itemId, { spaceId: null })))
    await fetchSpace()
    showSuccess(selectedIds.length === 1 ? 'Removed item from space' : `Removed ${selectedIds.length} items from space`)
  }

  const handleSaveDetails = async () => {
    if (!currentAccountId || !space) return

    try {
      if (!editedName.trim()) {
        showError('Name is required')
        return
      }

      const updatedSpace = await spaceService.updateSpace(currentAccountId, space.id, {
        name: editedName.trim(),
        notes: editedNotes,
      })
      setSpace(updatedSpace)
      setIsEditing(false)
      setTemplateFormData(prev => ({
        ...prev,
        name: updatedSpace.name,
        notes: updatedSpace.notes || '',
      }))
      showSuccess('Space updated')
    } catch (error) {
      console.error('Error updating space details:', error)
      showError('Failed to update space')
    }
  }

  const handleAddImage = async () => {
    if (!currentAccountId || !space || !project) return

    setIsUploadingImage(true)
    try {
      const files = await ImageUploadService.selectFromGallery()

      if (!files.length) {
        return
      }

      const uploadPromises = files.map(async (file) => {
        const result = await OfflineAwareImageService.uploadSpaceImage(
          file,
          project.name,
          space.id,
          currentAccountId
        )

        const image: ItemImage = {
          url: result.url,
          alt: result.fileName,
          isPrimary: false,
          uploadedAt: new Date(),
          fileName: result.fileName,
          size: result.size,
          mimeType: result.mimeType,
        }

        return image
      })

      const newImages = await Promise.all(uploadPromises)
      const updatedImages = [...(space.images || []), ...newImages]

      await spaceService.updateSpace(currentAccountId, space.id, { images: updatedImages })
      await fetchSpace()
      showSuccess('Images uploaded')
    } catch (error) {
      console.error('Error uploading images:', error)

      if (error instanceof Error) {
        if (error.message?.includes('timeout') || error.message?.includes('canceled')) {
          console.log('User canceled image selection or selection timed out')
          return
        }
      }

      showError('Failed to upload images')
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleRemoveImage = async (imageUrl: string) => {
    if (!currentAccountId || !space) return

    try {
      await spaceService.removeSpaceImage(currentAccountId, space.id, imageUrl)
      await fetchSpace()
      showSuccess('Image removed')
    } catch (error) {
      console.error('Error removing image:', error)
      showError('Failed to remove image')
    }
  }

  const handleSetPrimaryImage = async (imageUrl: string) => {
    if (!currentAccountId || !space) return

    try {
      await spaceService.setSpacePrimaryImage(currentAccountId, space.id, imageUrl)
      await fetchSpace()
      showSuccess('Primary image updated')
    } catch (error) {
      console.error('Error setting primary image:', error)
      showError('Failed to set primary image')
    }
  }

  const handleDelete = async () => {
    if (!currentAccountId || !space) return

    setIsDeleting(true)
    try {
      await spaceService.deleteSpace(currentAccountId, space.id)
      showSuccess('Space deleted')
      navigate(buildContextUrl(projectSpaces(projectId!)))
    } catch (error) {
      console.error('Error deleting space:', error)
      showError('Failed to delete space')
      setIsDeleting(false)
    }
  }

  const handleSaveAsTemplate = async () => {
    if (!currentAccountId || !space) return

    if (!templateFormData.name.trim()) {
      showError('Template name is required')
      return
    }

    setIsSavingTemplate(true)
    try {
      await spaceTemplatesService.createTemplate({
        accountId: currentAccountId,
        name: templateFormData.name.trim(),
        notes: templateFormData.notes.trim() || null,
      })
      showSuccess('Template created')
      setShowSaveAsTemplateModal(false)
    } catch (error) {
      console.error('Error creating template:', error)
      showError('Failed to create template')
    } finally {
      setIsSavingTemplate(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading space...</p>
        </div>
      </div>
    )
  }

  if (!space) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Space not found</h3>
        <ContextBackLink fallback={backDestination} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Spaces
        </ContextBackLink>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <ContextBackLink fallback={backDestination} className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </ContextBackLink>
        <div className="relative" ref={actionsMenuRef}>
          <button
            onClick={() => setShowActionsMenu(!showActionsMenu)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            aria-haspopup="menu"
            aria-expanded={showActionsMenu}
          >
            <span className="sr-only">Open actions menu</span>
            <MoreVertical className="h-4 w-4" />
          </button>
          {showActionsMenu && (
            <div className="absolute right-0 top-full mt-2 w-40 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-10">
              {isAdmin && (
                <button
                  onClick={() => {
                    setShowSaveAsTemplateModal(true)
                    setShowActionsMenu(false)
                  }}
                  className="flex w-full items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  role="menuitem"
                >
                  <Save className="h-4 w-4 mr-2 text-gray-500" />
                  Save as Template
                </button>
              )}
              <button
                onClick={() => {
                  if (!isEditing) {
                    setEditedName(space.name)
                    setEditedNotes(space.notes || '')
                  }
                  setIsEditing(!isEditing)
                  setShowActionsMenu(false)
                }}
                className="flex w-full items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                role="menuitem"
              >
                <Edit className="h-4 w-4 mr-2 text-gray-500" />
                Edit
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(true)
                  setShowActionsMenu(false)
                }}
                className="flex w-full items-center px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                role="menuitem"
              >
                <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Name */}
      <div>
        {isEditing ? (
          <div className="space-y-2">
            <label htmlFor="space-name" className="block text-sm font-medium text-gray-700">
              Space Name
            </label>
            <input
              id="space-name"
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-2xl font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Enter space name"
            />
          </div>
        ) : (
          <h1 className="text-3xl font-bold text-gray-900">{space.name}</h1>
        )}
        {space.projectId === null && (
          <p className="text-sm text-gray-500 mt-1">Account-wide space</p>
        )}
      </div>

      {/* Notes section */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Notes</h2>
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={6}
              placeholder="Add notes about this space..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsEditing(false)
                  setEditedName(space.name)
                  setEditedNotes(space.notes || '')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDetails}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div>
            {space.notes ? (
              <p className="text-gray-700 whitespace-pre-wrap">{space.notes}</p>
            ) : (
              <p className="text-gray-400 italic">No notes yet</p>
            )}
          </div>
        )}
      </div>

      {/* Space Images */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <ImagePlus className="h-5 w-5 mr-2" />
            Space Images
          </h2>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleAddImage}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              disabled={isUploadingImage}
            >
              <ImagePlus className="h-3 w-3 mr-1" />
              Add Images
            </button>
            <UploadActivityIndicator isUploading={isUploadingImage} label="Uploading images" className="mt-1" />
          </div>
        </div>
        {space.images && space.images.length > 0 ? (
          <ImagePreview
            images={space.images}
            onRemoveImage={handleRemoveImage}
            onSetPrimary={handleSetPrimaryImage}
            maxImages={20}
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

      {/* Associated items */}
      <div className="bg-white rounded-lg shadow p-6" id="space-items-container">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Space Items ({associatedItems.length})
        </h2>
        <TransactionItemsList
          items={spaceItems}
          onItemsChange={setSpaceItems}
          onAddItem={handleCreateSpaceItem}
          onUpdateItem={handleUpdateSpaceItem}
          onDuplicateItem={handleDuplicateSpaceItem}
          onAddExistingItems={() => setShowExistingItemsModal(true)}
          projectId={projectId}
          projectName={project?.name}
          onImageFilesChange={handleImageFilesChange}
          containerId="space-items-container"
          sentinelId="space-items-sentinel"
          enableTransactionActions={false}
          bulkAction={{
            label: 'Remove',
            onRun: async (selectedIds) => bulkUnassignSpace(selectedIds)
          }}
          context="space"
        />
      </div>
      <div id="space-items-sentinel" className="h-1" />

      {/* Add Existing Items Modal */}
      {showExistingItemsModal && projectId && spaceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-4 h-[66vh] max-h-[66vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">Add Existing Items</h3>
              <button
                type="button"
                onClick={() => setShowExistingItemsModal(false)}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Close
              </button>
            </div>
            <div id="space-items-picker-modal" className="px-6 py-4 overflow-y-auto flex-1">
              <SpaceItemPicker
                projectId={projectId}
                spaceId={spaceId}
                excludedItemIds={new Set(associatedItems.map(item => item.itemId))}
                onItemsAdded={async () => {
                  setShowExistingItemsModal(false)
                  await fetchSpace()
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Space</h3>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to delete "{space.name}"? This action cannot be undone.
            </p>
            {associatedItems.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                <p className="text-sm text-yellow-700">
                  This space has {associatedItems.length} item(s). Items will not be deleted, but their space assignment will be cleared.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {showSaveAsTemplateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Save as New Template</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="template-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="template-name"
                  value={templateFormData.name}
                  onChange={(e) => setTemplateFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g., Living Room Template"
                />
              </div>
              <div>
                <label htmlFor="template-notes" className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  id="template-notes"
                  value={templateFormData.notes}
                  onChange={(e) => setTemplateFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  rows={4}
                  placeholder="Add any notes about this template..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowSaveAsTemplateModal(false)}
                disabled={isSavingTemplate}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={isSavingTemplate || !templateFormData.name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {isSavingTemplate ? 'Creating...' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
