import { offlineStore } from './offlineStore'
import { isNetworkOnline } from './networkStatusService'

export class OfflineMediaService {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file

  async saveMediaFile(
    accountId: string,
    itemId: string,
    file: File,
    expiresAt?: Date
  ): Promise<string> {
    // Validate file size
    if (file.size > this.MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${this.MAX_FILE_SIZE / (1024 * 1024)}MB.`)
    }

    // Check total storage usage
    const quotaStatus = await offlineStore.checkStorageQuota()
    const projectedUsage = quotaStatus.usageBytes + file.size

    if (projectedUsage > quotaStatus.quotaBytes) {
      throw new Error('Not enough storage space. Please delete some media files first.')
    }

    if (projectedUsage / quotaStatus.quotaBytes >= 0.9) {
      throw new Error('Storage quota nearly full')
    }

    // Save to IndexedDB
    const mediaId = await offlineStore.saveMedia({
      itemId,
      accountId,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
      expiresAt: expiresAt?.toISOString()
    })

    return mediaId
  }

  async getMediaFile(mediaId: string): Promise<{ blob: Blob; filename: string; mimeType: string } | null> {
    const mediaEntry = await offlineStore.getMedia(mediaId)
    if (!mediaEntry) return null

    return {
      blob: mediaEntry.blob,
      filename: mediaEntry.filename,
      mimeType: mediaEntry.mimeType
    }
  }

  async getMediaForItem(itemId: string): Promise<Array<{ id: string; filename: string; size: number; uploadedAt: string }>> {
    const mediaEntries = await offlineStore.getMediaForItem(itemId)
    return mediaEntries.map(entry => ({
      id: entry.id,
      filename: entry.filename,
      size: entry.size,
      uploadedAt: entry.uploadedAt
    }))
  }

  async deleteMediaFile(mediaId: string): Promise<void> {
    await offlineStore.deleteMedia(mediaId)

    // Clean up any queued uploads referencing this media
    try {
      const queueEntries = await offlineStore.getMediaUploadQueue()
      const relatedEntries = queueEntries.filter(entry => entry.mediaId === mediaId)
      await Promise.all(
        relatedEntries.map(entry => offlineStore.removeMediaUploadFromQueue(entry.id))
      )
    } catch (error) {
      console.warn('Failed to remove media upload queue entry for deleted media', {
        mediaId,
        error
      })
    }
  }

  async cleanupExpiredMedia(): Promise<number> {
    return await offlineStore.cleanupExpiredMedia()
  }

  async getStorageStatus(): Promise<{
    usedBytes: number
    totalBytes: number
    usagePercent: number
    canUpload: boolean
  }> {
    const quotaStatus = await offlineStore.checkStorageQuota()

    return {
      usedBytes: quotaStatus.usageBytes,
      totalBytes: quotaStatus.quotaBytes,
      usagePercent: Math.round(quotaStatus.usageRatio * 100),
      canUpload: quotaStatus.usageRatio < 0.9
    }
  }

  // Strategy: For offline operations, queue media uploads
  // When offline, store files locally and mark for upload when online
  async queueMediaUpload(
    accountId: string,
    itemId: string,
    file: File,
    metadata?: {
      isPrimary?: boolean
      caption?: string
    }
  ): Promise<{ mediaId: string; queued: boolean }> {
    // Always store locally first
    const mediaId = await this.saveMediaFile(accountId, itemId, file)

    // If offline, mark for later upload
    const isOnline = isNetworkOnline()
    if (!isOnline) {
      // Store upload intent for when we come back online
      await this.markForUpload(mediaId, {
        accountId,
        itemId,
        metadata
      })
    }

    return {
      mediaId,
      queued: !isOnline
    }
  }

  private async markForUpload(
    mediaId: string,
    uploadData: {
      accountId: string
      itemId: string
      metadata?: { isPrimary?: boolean; caption?: string }
    }
  ): Promise<void> {
    // Store upload intent in IndexedDB
    await offlineStore.addMediaUploadToQueue({
      mediaId,
      accountId: uploadData.accountId,
      itemId: uploadData.itemId,
      metadata: uploadData.metadata
    })
  }

  async processQueuedUploads(accountId?: string): Promise<{ processed: number; failed: number }> {
    const uploadQueue = await offlineStore.getMediaUploadQueue(accountId)
    let processed = 0
    let failed = 0

    for (const upload of uploadQueue) {
      try {
        const mediaFile = await this.getMediaFile(upload.mediaId)
        if (!mediaFile) {
          console.warn(`Media file ${upload.mediaId} not found, removing from queue`)
          await offlineStore.removeMediaUploadFromQueue(upload.id)
          continue
        }

        // Here you would upload to your cloud storage service (e.g., Supabase Storage)
        // For now, this is a placeholder - actual implementation would call ImageUploadService
        console.log(`Would upload ${mediaFile.filename} for item ${upload.itemId}`)

        // If successful, remove from queue
        // Note: Don't delete local copy immediately - keep it until confirmed uploaded
        await offlineStore.removeMediaUploadFromQueue(upload.id)
        processed++

      } catch (error) {
        console.error(`Failed to upload media ${upload.mediaId}:`, error)
        // Increment retry count
        const newRetryCount = upload.retryCount + 1
        if (newRetryCount >= 5) {
          // Give up after 5 retries
          await offlineStore.removeMediaUploadFromQueue(upload.id)
          failed++
        } else {
          await offlineStore.updateMediaUploadQueueEntry(upload.id, {
            retryCount: newRetryCount,
            lastError: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    return { processed, failed }
  }

  async getQueuedUploadsCount(accountId?: string): Promise<number> {
    const queue = await offlineStore.getMediaUploadQueue(accountId)
    return queue.length
  }
}

export const offlineMediaService = new OfflineMediaService()