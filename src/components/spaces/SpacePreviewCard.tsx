import { useState, useEffect, useRef } from 'react'
import { MapPin, Building2 } from 'lucide-react'
import ContextLink from '@/components/ContextLink'
import { useNavigationContext } from '@/hooks/useNavigationContext'
import { offlineMediaService } from '@/services/offlineMediaService'
import { Space } from '@/types'
import { projectSpaceDetail } from '@/utils/routes'

interface SpacePreviewCardProps {
  space: Space
  itemCount?: number
  projectId: string
  onClick?: () => void
}

export default function SpacePreviewCard({
  space,
  itemCount = 0,
  projectId,
  onClick
}: SpacePreviewCardProps) {
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({})
  const resolvedUrlsRef = useRef<Record<string, string>>({})
  const { buildContextUrl } = useNavigationContext()

  useEffect(() => {
    resolvedUrlsRef.current = resolvedUrls
  }, [resolvedUrls])

  // Resolve offline image URLs
  useEffect(() => {
    if (!space.images || space.images.length === 0) return

    const resolveUrls = async () => {
      const newResolvedUrls: Record<string, string> = {}
      
      for (const image of space.images || []) {
        if (image.url.startsWith('offline://')) {
          try {
            const mediaId = image.url.replace('offline://', '')
            const blob = await offlineMediaService.getMediaBlob(mediaId)
            if (blob) {
              const url = URL.createObjectURL(blob)
              newResolvedUrls[image.url] = url
            }
          } catch (error) {
            console.warn('Failed to resolve offline image:', error)
          }
        }
      }

      if (Object.keys(newResolvedUrls).length > 0) {
        setResolvedUrls(prev => ({ ...prev, ...newResolvedUrls }))
      }
    }

    resolveUrls()

    // Cleanup object URLs on unmount
    return () => {
      Object.values(resolvedUrlsRef.current).forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
    }
  }, [space.images])

  const primaryImage = space.images?.find(img => img.isPrimary) || space.images?.[0]
  const imageUrl = primaryImage ? (resolvedUrls[primaryImage.url] || primaryImage.url) : null
  const isAccountWide = space.projectId === null
  const linkUrl = buildContextUrl(projectSpaceDetail(projectId, space.id))

  const cardContent = (
    <div className="space-y-3">
      {/* Image */}
      <div className="aspect-video w-full overflow-hidden rounded-md bg-gray-200">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={primaryImage?.alt || space.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <MapPin className="h-12 w-12 text-gray-400" />
          </div>
        )}
      </div>

      {/* Name and metadata */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-1">{space.name}</h3>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            {isAccountWide ? (
              <>
                <Building2 className="h-3 w-3" />
                Account-wide
              </>
            ) : (
              'Project'
            )}
          </span>
        </div>
      </div>
    </div>
  )

  if (onClick) {
    return (
      <div
        onClick={onClick}
        className="bg-white border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        {cardContent}
      </div>
    )
  }

  return (
    <ContextLink to={linkUrl} className="block">
      <div className="bg-white border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
        {cardContent}
      </div>
    </ContextLink>
  )
}
