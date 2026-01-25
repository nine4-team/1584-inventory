import React, { useMemo, useState, useRef, useCallback } from 'react'
import { Upload, Image as ImageIcon, FileText, AlertCircle, ChevronDown, Trash2, Eye } from 'lucide-react'
import { ImageUploadService } from '@/services/imageService'
import { OfflineAwareImageService } from '@/services/offlineAwareImageService'
import { useNetworkState } from '@/hooks/useNetworkState'

interface ImageUploadProps {
  onImagesChange: (files: File[]) => void
  maxImages?: number
  acceptedTypes?: string[]
  maxFileSize?: number // in MB
  disabled?: boolean
  className?: string
}

interface PreviewImage {
  file: File
  previewUrl: string
  isUploading?: boolean
  uploadProgress?: number
  error?: string
}

export default function ImageUpload({
  onImagesChange,
  maxImages = 5,
  acceptedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  maxFileSize = 10,
  disabled = false,
  className = ''
}: ImageUploadProps) {
  const [images, setImages] = useState<PreviewImage[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { isOnline } = useNetworkState()

  const supportsPdf = useMemo(() => acceptedTypes.includes('application/pdf'), [acceptedTypes])
  const supportsImages = useMemo(() => acceptedTypes.some(t => t.startsWith('image/')), [acceptedTypes])
  const acceptsLabel = useMemo(() => {
    const parts: string[] = []
    if (acceptedTypes.some(t => t.startsWith('image/'))) parts.push('images')
    if (supportsPdf) parts.push('PDFs')
    return parts.length > 0 ? parts.join(' and ') : 'files'
  }, [acceptedTypes, supportsPdf])

  const isRenderableImageFile = (file: File): boolean => {
    const mime = (file.type || '').toLowerCase()
    if (mime.startsWith('image/')) return true
    return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(file.name)
  }

  const isPdfFile = (file: File): boolean => {
    const mime = (file.type || '').toLowerCase()
    if (mime === 'application/pdf' || mime.includes('pdf')) return true
    return file.name.toLowerCase().endsWith('.pdf')
  }

  const validateFile = useCallback(async (file: File): Promise<string | null> => {
    // Some browsers provide an empty MIME type (especially for certain files).
    // Fall back to file extension checks for PDFs and common image types.
    if (file.type) {
      if (!acceptedTypes.includes(file.type)) {
        return `Invalid file type. Please upload: ${acceptedTypes.join(', ')}`
      }
    } else {
      if (isPdfFile(file) && supportsPdf) {
        // ok
      } else if (isRenderableImageFile(file) && supportsImages) {
        // ok
      } else {
        return `Invalid file type. Please upload: ${acceptedTypes.join(', ')}`
      }
    }

    const maxSizeBytes = maxFileSize * 1024 * 1024
    if (file.size > maxSizeBytes) {
      return `File too large. Maximum size: ${maxFileSize}MB`
    }

    // Check storage quota for offline storage
    if (!isOnline) {
      const quotaCheck = await OfflineAwareImageService.canUpload(file.size)
      if (!quotaCheck.allowed) {
        return quotaCheck.reason || 'Storage quota exceeded'
      }
    }

    return null
  }, [acceptedTypes, maxFileSize, isPdfFile, isRenderableImageFile, supportsImages, supportsPdf, isOnline])

  const addImages = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    const validFiles: File[] = []
    const newPreviewImages: PreviewImage[] = []

    // Validate files (async for quota checks)
    for (const file of fileArray) {
      const error = await validateFile(file)
      if (error) {
        newPreviewImages.push({
          file,
          previewUrl: '',
          error
        })
        if (error.includes('Storage quota')) {
          setStorageError(error)
        }
      } else {
        validFiles.push(file)
        newPreviewImages.push({
          file,
          previewUrl: ImageUploadService.createPreviewUrl(file)
        })
      }
    }

    const existingValidFiles = images.filter(img => !img.error).map(img => img.file)
    const existingValidCount = existingValidFiles.length

    if (validFiles.length + existingValidCount > maxImages) {
      const allowedCount = maxImages - existingValidCount
      if (allowedCount > 0) {
        validFiles.splice(allowedCount)
        newPreviewImages.splice(allowedCount)
      } else {
        validFiles.length = 0
        newPreviewImages.length = 0
      }

      newPreviewImages.push({
        file: new File([], ''),
        previewUrl: '',
        error: `Maximum ${maxImages} images allowed. Additional images were skipped.`
      })
    }

    setImages(prev => [...prev, ...newPreviewImages])

    const combinedFiles = [...existingValidFiles, ...validFiles]
    const limitedFiles = combinedFiles.slice(0, maxImages)
    onImagesChange(limitedFiles)
    
    // Clear storage error after a delay
    if (storageError) {
      setTimeout(() => setStorageError(null), 5000)
    }
  }, [images, maxImages, validateFile, onImagesChange, storageError])

  const removeImage = useCallback((index: number) => {
    const imageToRemove = images[index]

    // Clean up preview URL
    if (imageToRemove.previewUrl) {
      ImageUploadService.revokePreviewUrl(imageToRemove.previewUrl)
    }

    setImages(prev => prev.filter((_, i) => i !== index))

    // Update parent component with remaining files
    const remainingFiles = images
      .filter((_, i) => i !== index)
      .filter(img => !img.error)
      .map(img => img.file)

    onImagesChange(remainingFiles)
  }, [images, onImagesChange])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      await addImages(files)
    }
  }


  const handleGallerySelect = async () => {
    try {
      const files = await ImageUploadService.selectFromGallery()
      if (files.length > 0) {
        await addImages(files)
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('canceled'))) {
        return
      }
      console.error('Error selecting from gallery:', error)
    }
  }

  const handleCameraCapture = async () => {
    try {
      const file = await ImageUploadService.takePhoto()
      if (file) {
        await addImages([file])
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('canceled'))) {
        return
      }
      console.error('Error capturing photo:', error)
    }
  }

  const handleAddButtonClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return

    // Images: offer a tiny menu so users can choose camera/library (and PDFs if allowed).
    if (supportsImages) {
      setIsAddMenuOpen(prev => !prev)
      return
    }

    // Images only: use the mobile-friendly chooser (camera/library).
    if (supportsImages) {
      await handleGallerySelect()
      return
    }

    // PDFs only (or other non-image types): open the file picker.
    fileInputRef.current?.click()
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragOver(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (disabled) return

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      await addImages(files)
    }
  }, [disabled, addImages])

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sizes[i]
  }

  const toggleMenu = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    setOpenMenuIndex(openMenuIndex === index ? null : index)
  }

  const handleMenuAction = (e: React.MouseEvent, action: string, index: number) => {
    e.stopPropagation()
    setOpenMenuIndex(null)

    switch (action) {
      case 'preview':
        // Open in new tab
        window.open(images[index].previewUrl, '_blank', 'noopener,noreferrer')
        break
      case 'delete':
        removeImage(index)
        break
    }
  }

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenuIndex !== null && !(e.target as Element).closest('.image-menu-container')) {
        setOpenMenuIndex(null)
      }
      if (isAddMenuOpen && !(e.target as Element).closest('.add-attachment-menu-container')) {
        setIsAddMenuOpen(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [openMenuIndex, isAddMenuOpen])

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Storage Error Banner */}
      {storageError && (
        <div className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-900">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{storageError}</span>
          </div>
        </div>
      )}
      
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-6 sm:p-8 text-center transition-colors touch-manipulation ${
          isDragOver
            ? 'border-primary-500 bg-primary-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileSelect}
          disabled={disabled}
          className="hidden"
        />

        <div className="flex flex-col items-center space-y-2">
          <div className={`p-3 rounded-full ${isDragOver ? 'bg-primary-100' : 'bg-gray-100'}`}>
            <Upload className={`h-6 w-6 ${isDragOver ? 'text-primary-600' : 'text-gray-600'}`} />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-900">
              Drop {acceptsLabel} here, or click to browse
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Max {maxFileSize}MB each, up to {maxImages} files
            </p>
          </div>

          <div className="relative add-attachment-menu-container inline-flex items-center mt-3">
            <button
              type="button"
              onClick={handleAddButtonClick}
              disabled={disabled}
              className="inline-flex items-center justify-center px-4 py-2.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 touch-manipulation"
              title={supportsPdf ? 'Add receipts (photos or PDF)' : 'Add images from gallery or camera'}
            >
              <ImageIcon className="h-4 w-4 mr-2" />
              Add {supportsPdf ? 'Receipts' : 'Images'}
              {supportsImages && <ChevronDown className="h-4 w-4 ml-2 text-gray-500" />}
            </button>

            {supportsImages && isAddMenuOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-44 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
                <button
                  type="button"
                  onClick={async (ev) => {
                    ev.stopPropagation()
                    setIsAddMenuOpen(false)
                    await handleCameraCapture()
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                >
                  <ImageIcon className="h-4 w-4 mr-2 text-gray-500" />
                  Take photo
                </button>
                <button
                  type="button"
                  onClick={async (ev) => {
                    ev.stopPropagation()
                    setIsAddMenuOpen(false)
                    await handleGallerySelect()
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                >
                  <ImageIcon className="h-4 w-4 mr-2 text-gray-500" />
                  Photo library
                </button>
                {supportsPdf && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      setIsAddMenuOpen(false)
                      // Allow selecting PDFs (and images) from the same picker.
                      fileInputRef.current?.click()
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                  >
                    <FileText className="h-4 w-4 mr-2 text-gray-500" />
                    PDF / Browse files
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Previews */}
      {images.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Attachments</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {images.map((image, index) => (
              <div key={index} className="relative group">
                <div className="aspect-w-4 aspect-h-3 rounded-lg overflow-visible bg-gray-100">
                  {image.error ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center p-4">
                        <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                        <p className="text-xs text-red-600">{image.error}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isRenderableImageFile(image.file) ? (
                        <img
                          src={image.previewUrl}
                          alt={image.file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-700 bg-gray-50 p-2">
                          <FileText className="h-8 w-8 text-gray-500" />
                          <p className="mt-1 text-xs font-medium">
                            {isPdfFile(image.file) ? 'PDF' : 'File'}
                          </p>
                        </div>
                      )}

                      {image.isUploading && (
                        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                          <div className="text-white text-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-2"></div>
                            <p className="text-xs">
                              {image.uploadProgress ? `${Math.round(image.uploadProgress)}%` : 'Uploading...'}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="absolute top-1 right-1 image-menu-container">
                        <button
                          type="button"
                          onClick={(e) => toggleMenu(e, index)}
                          className="p-1.5 bg-primary-500 text-white rounded-full opacity-90 hover:opacity-100 transition-opacity"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>

                        {/* Dropdown menu */}
                        {openMenuIndex === index && (
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 w-28 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
                            <button
                              onClick={(e) => handleMenuAction(e, 'preview', index)}
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                            >
                              <Eye className="h-4 w-4 mr-2 text-gray-500" />
                              Open
                            </button>
                            <button
                              onClick={(e) => handleMenuAction(e, 'delete', index)}
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
                            >
                              <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-1">
                  <p className="text-xs text-gray-500 truncate" title={image.file.name}>
                    {image.file.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatFileSize(image.file.size)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
