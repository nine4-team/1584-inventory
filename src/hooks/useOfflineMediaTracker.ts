import { useRef, useEffect } from 'react'
import { offlineMediaService } from '@/services/offlineMediaService'

/**
 * Hook to track offline media IDs and clean them up on unmount
 * This prevents orphaned files when components unmount before images are saved
 * 
 * Usage:
 * ```tsx
 * const { trackMediaId, removeMediaId, cleanup } = useOfflineMediaTracker()
 * 
 * // When uploading offline:
 * const mediaId = '...'
 * trackMediaId(mediaId)
 * 
 * // After saving:
 * removeMediaId(mediaId)
 * 
 * // Cleanup is automatic on unmount
 * ```
 */
export function useOfflineMediaTracker() {
  const offlineMediaIdsRef = useRef<Set<string>>(new Set())

  const trackMediaId = (mediaId: string) => {
    offlineMediaIdsRef.current.add(mediaId)
  }

  const removeMediaId = (mediaId: string) => {
    offlineMediaIdsRef.current.delete(mediaId)
  }

  const cleanup = async () => {
    const mediaIds = Array.from(offlineMediaIdsRef.current)
    await Promise.all(
      mediaIds.map(mediaId =>
        offlineMediaService.deleteMediaFile(mediaId).catch(error => {
          console.warn('Failed to cleanup offline media:', error)
        })
      )
    )
    offlineMediaIdsRef.current.clear()
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const mediaIds = Array.from(offlineMediaIdsRef.current)
      mediaIds.forEach(mediaId => {
        offlineMediaService.deleteMediaFile(mediaId).catch(error => {
          console.warn('Failed to cleanup offline media on unmount:', error)
        })
      })
    }
  }, [])

  return {
    trackMediaId,
    removeMediaId,
    cleanup,
    getMediaIds: () => Array.from(offlineMediaIdsRef.current)
  }
}
