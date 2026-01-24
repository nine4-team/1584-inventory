import { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowLeft, Edit, Trash2, ImagePlus, Pin, Save } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import ContextBackLink from '@/components/ContextBackLink'
import { Space, Item, ItemImage, Project } from '@/types'
import { spaceService } from '@/services/spaceService'
import { spaceTemplatesService } from '@/services/spaceTemplatesService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { ImageUploadService } from '@/services/imageService'
import ImagePreview from '@/components/ui/ImagePreview'
import ImageGallery from '@/components/ui/ImageGallery'
import { useToast } from '@/components/ui/ToastContext'
import { useAccount } from '@/contexts/AccountContext'
import { projectService, unifiedItemsService } from '@/services/inventoryService'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { projectSpaces } from '@/utils/routes'
import ItemPreviewCard from '@/components/items/ItemPreviewCard'

export default function SpaceDetail() {
  const { projectId, spaceId } = useParams<{ projectId: string; spaceId: string }>()
  const navigate = useNavigate()
  const { currentAccountId, isAdmin } = useAccount()
  const { buildContextUrl, getBackDestination } = useNavigationContext()
  const { showError, showSuccess } = useToast()

  const [space, setSpace] = useState<Space | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [associatedItems, setAssociatedItems] = useState<Item[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedNotes, setEditedNotes] = useState('')
  const [showGallery, setShowGallery] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [showSaveAsTemplateModal, setShowSaveAsTemplateModal] = useState(false)
  const [templateFormData, setTemplateFormData] = useState({ name: '', notes: '' })
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)

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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowSaveAsTemplateModal(true)}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              <Save className="h-4 w-4 mr-2" />
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
            }}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </button>
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

      {/* Gallery */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Gallery</h2>
          <ImagePreview
            images={space.images || []}
            onAddImage={handleAddImage}
            onRemoveImage={handleRemoveImage}
            onSetPrimary={handleSetPrimaryImage}
            maxImages={20}
            showControls={true}
          />
        </div>
        {space.images && space.images.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {space.images.map((image, index) => (
              <div
                key={image.url}
                className="relative aspect-square cursor-pointer group"
                onClick={() => {
                  setGalleryIndex(index)
                  setShowGallery(true)
                }}
              >
                <img
                  src={image.url}
                  alt={image.alt || space.name}
                  className="w-full h-full object-cover rounded-md"
                />
                {image.isPrimary && (
                  <div className="absolute top-2 right-2 bg-primary-600 text-white p-1 rounded">
                    <Pin className="h-3 w-3" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 italic">No images yet</p>
        )}
      </div>

      {/* Associated items */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Associated Items ({associatedItems.length})
        </h2>
        {associatedItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {associatedItems.map(item => (
              <ItemPreviewCard
                key={item.itemId}
                item={item}
                projectId={projectId}
              />
            ))}
          </div>
        ) : (
          <p className="text-gray-400 italic">No items in this space</p>
        )}
      </div>

      {/* Image Gallery Modal */}
      {showGallery && space.images && space.images.length > 0 && (
        <ImageGallery
          images={space.images}
          initialIndex={galleryIndex}
          onClose={() => setShowGallery(false)}
        />
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
