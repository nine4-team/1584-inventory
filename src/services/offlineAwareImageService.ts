import { ImageUploadService } from './imageService'
import { offlineMediaService } from './offlineMediaService'
import { isNetworkOnline } from './networkStatusService'

/**
 * Offline-aware image upload service that queues uploads when offline
 * and processes them when online.
 */
export class OfflineAwareImageService {
  /**
   * Upload an image, storing it offline if network is unavailable
   */
  static async uploadItemImage(
    file: File,
    projectName: string,
    itemId: string,
    accountId: string,
    onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void
  ): Promise<{ url: string; fileName: string; size: number; mimeType: string }> {
    const isOnline = isNetworkOnline()

    if (!isOnline) {
      // Store offline and queue for upload
      const { mediaId } = await offlineMediaService.queueMediaUpload(accountId, itemId, file)

      // Return a placeholder URL that indicates offline storage
      // The actual upload will happen when online
      return {
        url: `offline://${mediaId}`,
        fileName: file.name,
        size: file.size,
        mimeType: file.type
      }
    }

    // Online: upload immediately
    return await ImageUploadService.uploadItemImage(file, projectName, itemId, onProgress)
  }

  /**
   * Process queued uploads when coming back online
   */
  static async processQueuedUploads(accountId?: string): Promise<{ processed: number; failed: number }> {
    return await offlineMediaService.processQueuedUploads(accountId)
  }

  /**
   * Get storage status
   */
  static async getStorageStatus() {
    return await offlineMediaService.getStorageStatus()
  }

  /**
   * Check if storage quota allows upload
   */
  static async canUpload(fileSize: number): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const status = await offlineMediaService.getStorageStatus()
      const projectedUsage = status.usedBytes + fileSize

      if (projectedUsage > status.totalBytes) {
        return {
          allowed: false,
          reason: 'Not enough storage space. Please delete some media files first.'
        }
      }

      if (projectedUsage / status.totalBytes >= 0.9) {
        return {
          allowed: false,
          reason: 'Storage quota nearly full (90%+). Please free up space before uploading.'
        }
      }

      return { allowed: true }
    } catch (error) {
      console.error('Failed to check storage quota:', error)
      // Allow upload if check fails (fail open)
      return { allowed: true }
    }
  }

  /**
   * Upload a receipt attachment (PDF or image), storing it offline if network is unavailable
   * Uses transactionId as the identifier for offline storage
   */
  static async uploadReceiptAttachment(
    file: File,
    projectName: string,
    transactionId: string,
    accountId: string,
    onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void
  ): Promise<{ url: string; fileName: string; size: number; mimeType: string }> {
    const isOnline = isNetworkOnline()

    if (!isOnline) {
      // Store offline and queue for upload
      // Use transactionId as the "itemId" parameter since it's just an identifier
      const { mediaId } = await offlineMediaService.queueMediaUpload(accountId, transactionId, file)

      return {
        url: `offline://${mediaId}`,
        fileName: file.name,
        size: file.size,
        mimeType: file.type
      }
    }

    // Online: upload immediately
    return await ImageUploadService.uploadReceiptAttachment(file, projectName, transactionId, onProgress)
  }

  /**
   * Upload an "other" attachment, storing it offline if network is unavailable
   * Uses transactionId as the identifier for offline storage
   */
  static async uploadOtherAttachment(
    file: File,
    projectName: string,
    transactionId: string,
    accountId: string,
    onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void
  ): Promise<{ url: string; fileName: string; size: number; mimeType: string }> {
    const isOnline = isNetworkOnline()

    if (!isOnline) {
      // Store offline and queue for upload
      // Use transactionId as the "itemId" parameter since it's just an identifier
      const { mediaId } = await offlineMediaService.queueMediaUpload(accountId, transactionId, file)

      return {
        url: `offline://${mediaId}`,
        fileName: file.name,
        size: file.size,
        mimeType: file.type
      }
    }

    // Online: upload immediately
    return await ImageUploadService.uploadOtherImage(file, projectName, transactionId, onProgress)
  }

  /**
   * Upload a space image, storing it offline if network is unavailable
   */
  static async uploadSpaceImage(
    file: File,
    projectName: string,
    spaceId: string,
    accountId: string,
    onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void
  ): Promise<{ url: string; fileName: string; size: number; mimeType: string }> {
    const isOnline = isNetworkOnline()

    if (!isOnline) {
      // Store offline and queue for upload
      const { mediaId } = await offlineMediaService.queueMediaUpload(accountId, spaceId, file)

      return {
        url: `offline://${mediaId}`,
        fileName: file.name,
        size: file.size,
        mimeType: file.type
      }
    }

    // Online: upload immediately
    return await ImageUploadService.uploadSpaceImage(file, projectName, spaceId, onProgress)
  }
}
