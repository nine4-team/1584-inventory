import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Plus, ChevronDown, Trash2, Star, ExternalLink, Crown, FileText, Pin } from 'lucide-react'
import { ItemImage, TransactionImage } from '@/types'
import ImageGallery from './ImageGallery'
import { offlineMediaService } from '@/services/offlineMediaService'

interface ImagePreviewProps {
  images: ItemImage[]
  onAddImage?: () => void
  onRemoveImage?: (imageUrl: string) => void
  onSetPrimary?: (imageUrl: string) => void
  // If null, there is no max image cap.
  maxImages?: number | null
  showControls?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

interface TransactionImagePreviewProps {
  images: TransactionImage[]
  onRemoveImage?: (imageUrl: string) => void
  onPinImage?: (image: TransactionImage) => void
  // Reserved for parity with ImagePreview; currently not enforced here.
  maxImages?: number | null
  showControls?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  onImageClick?: (imageUrl: string) => void
}

export default function ImagePreview({
  images,
  onAddImage,
  onRemoveImage,
  onSetPrimary,
  maxImages = 5,
  showControls = true,
  size = 'md',
  className = ''
}: ImagePreviewProps) {
  const [showGallery, setShowGallery] = useState(false)
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0)
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null)
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({})
  const resolvedUrlsRef = useRef<Record<string, string>>({})

  const sizeClasses = {
    sm: 'w-20 h-20 sm:w-16 sm:h-16',
    md: 'w-24 h-24 sm:w-20 sm:h-20',
    lg: 'w-28 h-28 sm:w-24 sm:h-24'
  }

  useEffect(() => {
    resolvedUrlsRef.current = resolvedUrls
  }, [resolvedUrls])

  useEffect(() => {
    let isMounted = true

    const resolveOfflineImages = async () => {
      for (const image of images) {
        if (!image.url.startsWith('offline://')) continue
        if (resolvedUrls[image.url]) continue

        const mediaId = image.url.replace('offline://', '')
        try {
          const mediaFile = await offlineMediaService.getMediaFile(mediaId)
          if (!mediaFile?.blob || !isMounted) continue

          const objectUrl = URL.createObjectURL(mediaFile.blob)
          setResolvedUrls(prev => {
            if (prev[image.url]) {
              URL.revokeObjectURL(objectUrl)
              return prev
            }
            return {
              ...prev,
              [image.url]: objectUrl
            }
          })
        } catch (error) {
          console.warn('Failed to resolve offline image preview:', error)
        }
      }
    }

    resolveOfflineImages()

    return () => {
      isMounted = false
    }
  }, [images, resolvedUrls])

  useEffect(() => {
    setResolvedUrls(prev => {
      const currentUrls = new Set(images.map(image => image.url))
      let changed = false
      const next: Record<string, string> = {}

      Object.entries(prev).forEach(([key, value]) => {
        if (currentUrls.has(key)) {
          next[key] = value
        } else {
          URL.revokeObjectURL(value)
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [images])

  useEffect(() => {
    return () => {
      Object.values(resolvedUrlsRef.current).forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const resolvedGalleryImages = useMemo(() => {
    return images.map(image => ({
      ...image,
      url: resolvedUrls[image.url] || image.url
    }))
  }, [images, resolvedUrls])

  const handleImageClick = (index: number) => {
    setGalleryInitialIndex(index)
    setShowGallery(true)
  }

  const handleGalleryClose = () => {
    setShowGallery(false)
  }

  const hasMaxImagesCap = typeof maxImages === 'number' && Number.isFinite(maxImages) && maxImages > 0


  const toggleMenu = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    setOpenMenuIndex(openMenuIndex === index ? null : index)
  }

  const handleMenuAction = (e: React.MouseEvent, action: string, imageUrl: string, index: number) => {
    e.stopPropagation()
    setOpenMenuIndex(null)

    switch (action) {
      case 'open':
        handleImageClick(index)
        break
      case 'setPrimary':
        onSetPrimary?.(imageUrl)
        break
      case 'delete':
        onRemoveImage?.(imageUrl)
        break
    }
  }

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenuIndex !== null && !(e.target as Element).closest('.image-menu-container')) {
        setOpenMenuIndex(null)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [openMenuIndex])

  if (images.length === 0 && !onAddImage) {
    return null
  }

  return (
    <>
      <div className={`space-y-3 ${className}`}>
        {/* Images grid */}
        {images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-6" style={{width: 'fit-content'}}>
            {images.map((image, index) => (
              <div
                key={image.url}
                className={`${sizeClasses[size]} relative group cursor-pointer rounded-lg overflow-visible border-2 ${
                  image.isPrimary ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200'
                }`}
                onClick={() => handleImageClick(index)}
              >
                <img
                  src={resolvedUrls[image.url] || image.url}
                  alt={image.alt || image.fileName}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />

                {/* Primary indicator */}
                {image.isPrimary && (
                  <div className="absolute top-1 left-1 bg-primary-500 bg-opacity-40 text-white text-xs p-1 rounded flex items-center justify-center border border-white">
                    <Crown className="h-3 w-3 fill-current" />
                  </div>
                )}

                {/* Controls overlay - Mobile-first design with chevron menu */}
                {showControls && (
                  <div className="absolute inset-0 bg-transparent transition-all duration-200">
                    {/* Chevron menu button - Upper right corner */}
                    <div className="absolute top-1 right-1 image-menu-container">
                      <button
                        onClick={(e) => toggleMenu(e, index)}
                        className="p-1.5 bg-primary-500 bg-opacity-40 rounded-full text-white border border-white hover:bg-primary-500 hover:bg-opacity-50 hover:text-white transition-colors"
                        title="Image options"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>

                      {/* Dropdown menu */}
                      {openMenuIndex === index && (
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 w-32 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50" style={{
                          transform: 'translateY(0)',
                          maxHeight: 'calc(100vh - 100px)',
                          overflowY: 'auto'
                        }}>
                          <button
                            onClick={(e) => handleMenuAction(e, 'open', image.url, index)}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            <span>Open</span>
                          </button>
                          {!image.isPrimary && onSetPrimary && (
                            <button
                              onClick={(e) => handleMenuAction(e, 'setPrimary', image.url, index)}
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                            >
                              <Star className="h-4 w-4 mr-2" />
                              <span>Primary</span>
                            </button>
                          )}
                          {onRemoveImage && (
                            <button
                              onClick={(e) => handleMenuAction(e, 'delete', image.url, index)}
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            ))}

            {/* Add image button */}
            {onAddImage && (!hasMaxImagesCap || images.length < (maxImages as number)) && (
              <button
                onClick={onAddImage}
                className={`${sizeClasses[size]} border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors`}
                title="Add image"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Add image button when no images exist */}
        {!images.length && onAddImage && (
          <button
            onClick={onAddImage}
            className={`${sizeClasses[size]} border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors w-full`}
            title="Add image"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}

        {/* Image count */}
        {images.length > 0 && (
          <p className="text-xs text-gray-500">
            {images.length} image{images.length !== 1 ? 's' : ''}
            {hasMaxImagesCap && ` (max ${maxImages})`}
          </p>
        )}
      </div>

      {/* Image gallery modal */}
      {showGallery && (
        <ImageGallery
          images={resolvedGalleryImages}
          initialIndex={galleryInitialIndex}
          onClose={handleGalleryClose}
        />
      )}
    </>
  )
}

// Transaction Image Preview Component - for receipt and other transaction images
// This component is similar to ImagePreview but without the Primary option
export function TransactionImagePreview({
  images,
  onRemoveImage,
  onPinImage,
  showControls = true,
  size = 'md',
  className = '',
  onImageClick
}: TransactionImagePreviewProps) {
  const [showGallery, setShowGallery] = useState(false)
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0)
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null)
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({})
  const resolvedUrlsRef = useRef<Record<string, string>>({})

  const sizeClasses = {
    sm: 'w-20 h-20 sm:w-16 sm:h-16',
    md: 'w-24 h-24 sm:w-20 sm:h-20',
    lg: 'w-28 h-28 sm:w-24 sm:h-24'
  }

  const isRenderableImage = (img: TransactionImage): boolean => {
    const mime = (img.mimeType || '').toLowerCase()
    if (mime.startsWith('image/')) return true
    const name = (img.fileName || img.url || '').toLowerCase()
    return /\.(png|jpe?g|gif|webp|heic|heif)$/.test(name)
  }

  const isPdfAttachment = (img: TransactionImage): boolean => {
    const mime = (img.mimeType || '').toLowerCase()
    if (mime === 'application/pdf' || mime.includes('pdf')) return true
    const name = (img.fileName || img.url || '').toLowerCase()
    return name.endsWith('.pdf')
  }

  const galleryImages = useMemo(() => {
    return images.filter(isRenderableImage)
  }, [images])

  useEffect(() => {
    resolvedUrlsRef.current = resolvedUrls
  }, [resolvedUrls])

  useEffect(() => {
    let isMounted = true

    const resolveOfflineAttachments = async () => {
      for (const image of images) {
        if (!image.url.startsWith('offline://')) continue
        if (resolvedUrls[image.url]) continue

        const mediaId = image.url.replace('offline://', '')
        try {
          const mediaFile = await offlineMediaService.getMediaFile(mediaId)
          if (!mediaFile?.blob || !isMounted) continue

          const objectUrl = URL.createObjectURL(mediaFile.blob)
          setResolvedUrls(prev => {
            if (prev[image.url]) {
              URL.revokeObjectURL(objectUrl)
              return prev
            }
            return {
              ...prev,
              [image.url]: objectUrl
            }
          })
        } catch (error) {
          console.warn('Failed to resolve offline transaction attachment:', error)
        }
      }
    }

    resolveOfflineAttachments()

    return () => {
      isMounted = false
    }
  }, [images, resolvedUrls])

  useEffect(() => {
    setResolvedUrls(prev => {
      const currentUrls = new Set(images.map(image => image.url))
      let changed = false
      const next: Record<string, string> = {}

      Object.entries(prev).forEach(([key, value]) => {
        if (currentUrls.has(key)) {
          next[key] = value
        } else {
          URL.revokeObjectURL(value)
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [images])

  useEffect(() => {
    return () => {
      Object.values(resolvedUrlsRef.current).forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const getDisplayUrl = (image: TransactionImage) => resolvedUrls[image.url] || image.url

  const resolvedGalleryImages = useMemo(() => {
    return galleryImages.map(img => ({
      ...img,
      url: getDisplayUrl(img)
    }))
  }, [galleryImages, resolvedUrls])

  const openAttachment = (url: string) => {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      // Fallback
      window.location.assign(url)
    }
  }

  const handleImageClick = (image: TransactionImage) => {
    if (isRenderableImage(image)) {
      if (onImageClick) {
        onImageClick(getDisplayUrl(image))
        return
      }

      const idx = galleryImages.findIndex(i => i.url === image.url)
      setGalleryInitialIndex(Math.max(0, idx))
      setShowGallery(true)
      return
    }

    // Non-image attachments (e.g., PDFs) open in a new tab.
    openAttachment(getDisplayUrl(image))
  }

  const handleGalleryClose = () => {
    setShowGallery(false)
  }

  const toggleMenu = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    setOpenMenuIndex(openMenuIndex === index ? null : index)
  }

  const handleMenuAction = (e: React.MouseEvent, action: string, imageUrl: string, index: number) => {
    e.stopPropagation()
    setOpenMenuIndex(null)

    switch (action) {
      case 'open':
        openAttachment(resolvedUrls[imageUrl] || imageUrl)
        break
      case 'pin':
        const image = images[index]
        if (image && isRenderableImage(image)) {
          onPinImage?.(image)
        }
        break
      case 'delete':
        onRemoveImage?.(imageUrl)
        break
    }
  }

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenuIndex !== null && !(e.target as Element).closest('.image-menu-container')) {
        setOpenMenuIndex(null)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [openMenuIndex])

  if (images.length === 0) {
    return null
  }

  return (
    <>
      <div className={`space-y-3 ${className}`}>
        {/* Images grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-6" style={{width: 'fit-content'}}>
          {images.map((image, index) => (
            <div
              key={image.url}
              className={`${sizeClasses[size]} relative group cursor-pointer rounded-lg overflow-visible border-2 border-gray-200`}
              onClick={() => handleImageClick(image)}
            >
              {isRenderableImage(image) ? (
                <img
                  src={getDisplayUrl(image)}
                  alt={image.fileName}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full bg-gray-50 flex flex-col items-center justify-center text-gray-600 p-2">
                  <FileText className="h-6 w-6" />
                  <div className="mt-1 text-[10px] font-medium text-gray-700 text-center line-clamp-2">
                    {isPdfAttachment(image) ? 'PDF' : 'File'}
                  </div>
                </div>
              )}

              {/* Controls overlay - Mobile-first design with chevron menu */}
              {showControls && (
                <div className="absolute inset-0 bg-transparent transition-all duration-200">
                  {/* Chevron menu button - Upper right corner */}
                  <div className="absolute top-1 right-1 image-menu-container">
                    <button
                      onClick={(e) => toggleMenu(e, index)}
                      className="p-1.5 bg-primary-500 bg-opacity-40 rounded-full text-white border border-white hover:bg-primary-500 hover:bg-opacity-50 hover:text-white transition-colors"
                      title="Image options"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>

                    {/* Dropdown menu */}
                    {openMenuIndex === index && (
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 w-32 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50" style={{
                        transform: 'translateY(0)',
                        maxHeight: 'calc(100vh - 100px)',
                        overflowY: 'auto'
                      }}>
                        <button
                            onClick={(e) => handleMenuAction(e, 'open', image.url, index)}
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                            <span>{isRenderableImage(image) ? 'Open' : 'Open file'}</span>
                        </button>
                        {onPinImage && isRenderableImage(image) && (
                          <button
                            onClick={(e) => handleMenuAction(e, 'pin', image.url, index)}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                          >
                            <Pin className="h-4 w-4 mr-2" />
                            <span>Pin</span>
                          </button>
                        )}
                        {onRemoveImage && (
                          <button
                            onClick={(e) => handleMenuAction(e, 'delete', image.url, index)}
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Image gallery modal */}
      {showGallery && (
        <ImageGallery
          images={resolvedGalleryImages.map(img => ({
            url: img.url,
            alt: img.fileName,
            isPrimary: false,
            uploadedAt: new Date(),
            fileName: img.fileName,
            size: img.size || 0,
            mimeType: img.mimeType || 'image/jpeg'
          }))}
          initialIndex={galleryInitialIndex}
          onClose={handleGalleryClose}
        />
      )}
    </>
  )
}
