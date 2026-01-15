import { supabase } from './supabase'
import { ensureAuthenticatedForDatabase } from './databaseService'
import { TransactionImage } from '@/types'
import {
  ImageUploadError,
  getUserFriendlyErrorMessage,
  convertImageFormat
} from '@/utils/imageUtils'

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export interface ImageUploadResult {
  url: string
  fileName: string
  size: number
  mimeType: string
}

export class ImageUploadService {
  /**
   * Check if Supabase Storage is available
   */
  static async checkStorageAvailability(): Promise<boolean> {
    try {
      if (!supabase) {
        console.error('Supabase not initialized')
        return false
      }
      return true
    } catch (error) {
      console.error('Storage availability check failed:', error)
      return false
    }
  }

  /**
   * Ensure user is authenticated before storage operations
   */
  static async ensureAuthentication(): Promise<void> {
    try {
      await ensureAuthenticatedForDatabase()
    } catch (error) {
      console.error('Failed to ensure authentication:', error)
      throw new Error('Authentication required for storage operations. Please refresh the page and try again.')
    }
  }

  /**
   * Upload an item image to Supabase Storage
   */
  static async uploadItemImage(
    file: File,
    projectName: string,
    itemId: string,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    return this.uploadImageInternal(file, projectName, itemId, 'item-images', onProgress, retryCount)
  }

  /**
   * Upload a transaction image to Supabase Storage (legacy method for backward compatibility)
   */
  static async uploadTransactionImage(
    file: File,
    projectName: string,
    transactionId: string,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    return this.uploadImageInternal(file, projectName, transactionId, 'transaction-images', onProgress, retryCount)
  }

  /**
   * Upload a receipt image to Supabase Storage
   */
  static async uploadReceiptImage(
    file: File,
    projectName: string,
    transactionId: string,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    return this.uploadImageInternal(file, projectName, transactionId, 'receipt-images', onProgress, retryCount)
  }

  /**
   * Upload an other image to Supabase Storage
   */
  static async uploadOtherImage(
    file: File,
    projectName: string,
    transactionId: string,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    return this.uploadImageInternal(file, projectName, transactionId, 'other-images', onProgress, retryCount)
  }

  /**
   * Upload a project main image to Supabase Storage
   */
  static async uploadProjectImage(
    file: File,
    projectName: string,
    projectId: string,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    return this.uploadImageInternal(file, projectName, projectId, 'project-images', onProgress, retryCount)
  }

  /**
   * Upload business logo to Supabase Storage
   */
  static async uploadBusinessLogo(
    accountId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    const MAX_RETRIES = 3

    console.log(`Upload attempt ${retryCount + 1}/${MAX_RETRIES + 1}`)

    await this.ensureAuthentication()

    const isStorageAvailable = await this.checkStorageAvailability()
    if (!isStorageAvailable) {
      throw new Error('Storage service is not available. Please check your connection and try again.')
    }

    const processedFile = await this._prepareImageForUpload(file)

    if (!this.validateImageFile(processedFile)) {
      throw new Error('Invalid image file. Please upload a valid image (JPEG, PNG, GIF, WebP, HEIC/HEIF) under 10MB.')
    }

    const timestamp = Date.now()
    const sanitizedFileName = processedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const fileName = `accounts/${accountId}/business_profile/logo/${timestamp}_${sanitizedFileName}`

    console.log('Uploading to path:', fileName, 'Size:', processedFile.size, 'Type:', processedFile.type)

    try {
      const { data, error } = await supabase.storage
        .from('business-logos')
        .upload(fileName, processedFile, {
          cacheControl: '3600',
          upsert: false
        })

      if (error) throw error

      // Use the path returned from Supabase (may differ from generated fileName)
      const uploadedPath = data?.path || fileName

      // Simulate progress if callback provided
      if (onProgress) {
        onProgress({ loaded: processedFile.size, total: processedFile.size, percentage: 100 })
      }

      // Get public URL using the actual uploaded path
      const { data: urlData } = supabase.storage
        .from('business-logos')
        .getPublicUrl(uploadedPath)

      if (!urlData?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded file')
      }

      return {
        url: urlData.publicUrl,
        fileName: uploadedPath,
        size: processedFile.size,
        mimeType: processedFile.type
      }
    } catch (error: any) {
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying upload (attempt ${retryCount + 2}/${MAX_RETRIES + 1})...`)
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)))
        return this.uploadBusinessLogo(accountId, file, onProgress, retryCount + 1)
      }

      const friendlyMessage = getUserFriendlyErrorMessage(error)
      throw new ImageUploadError(friendlyMessage, error.code, error)
    }
  }

  /**
   * Pre-processes an image file for upload (compression, conversion)
   */
  private static async _prepareImageForUpload(file: File): Promise<File> {
    let processedFile = file

    // Compress images on mobile devices to save bandwidth
    if (this.shouldCompressForMobile(processedFile)) {
      console.log('Compressing file for mobile upload...')
      processedFile = await this.compressForMobile(processedFile)
    }

    // If the file is HEIC/HEIF, attempt to convert it to JPEG for wider compatibility
    const lowerName = processedFile.name.toLowerCase()
    const isHeic =
      (processedFile.type && (processedFile.type.toLowerCase().includes('heic') || processedFile.type.toLowerCase().includes('heif'))) ||
      /\.(heic|heif)$/i.test(lowerName)

    if (isHeic) {
      try {
        console.log('Converting HEIC/HEIF to JPEG before upload...')
        processedFile = await convertImageFormat(processedFile, 'jpeg', 0.9)
      } catch (err) {
        console.warn('HEIC conversion failed:', err)
        // Throw a user-friendly error if conversion fails
        throw new ImageUploadError(
          'Upload failed: Could not convert HEIC/HEIF image. Please convert it to JPEG or PNG and try again.',
          undefined,
          err
        )
      }
    }
    
    return processedFile
  }

  /**
   * Internal upload method
   */
  private static async uploadImageInternal(
    file: File,
    projectName: string,
    id: string,
    imageType: 'item-images' | 'transaction-images' | 'receipt-images' | 'other-images' | 'project-images',
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    const MAX_RETRIES = 3

    console.log(`Upload attempt ${retryCount + 1}/${MAX_RETRIES + 1}`)

    await this.ensureAuthentication()

    const isStorageAvailable = await this.checkStorageAvailability()
    if (!isStorageAvailable) {
      throw new Error('Storage service is not available. Please check your connection and try again.')
    }

    const processedFile = await this._prepareImageForUpload(file)

    if (!this.validateImageFile(processedFile)) {
      throw new Error('Invalid image file. Please upload a valid image (JPEG, PNG, GIF, WebP, HEIC/HEIF) under 10MB.')
    }

    const timestamp = Date.now()
    const sanitizedFileName = processedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9-]/g, '_')
    const dateTime = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)
    const fileName = `${sanitizedProjectName}/${imageType}/${dateTime}/${timestamp}_${sanitizedFileName}`

    console.log('Uploading to path:', fileName, 'Size:', processedFile.size, 'Type:', processedFile.type)

    try {
      // Supabase Storage upload with progress simulation
      const { data, error } = await supabase.storage
        .from(imageType)
        .upload(fileName, processedFile, {
          cacheControl: '3600',
          upsert: false
        })

      if (error) throw error

      // Use the path returned from Supabase (may differ from generated fileName)
      const uploadedPath = data?.path || fileName

      // Simulate progress if callback provided
      if (onProgress) {
        onProgress({ loaded: processedFile.size, total: processedFile.size, percentage: 100 })
      }

      // Get public URL using the actual uploaded path
      const { data: urlData } = supabase.storage
        .from(imageType)
        .getPublicUrl(uploadedPath)

      if (!urlData?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded file')
      }

      return {
        url: urlData.publicUrl,
        fileName: uploadedPath,
        size: processedFile.size,
        mimeType: processedFile.type
      }
    } catch (error: any) {
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying upload (attempt ${retryCount + 2}/${MAX_RETRIES + 1})...`)
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)))
        return this.uploadImageInternal(file, projectName, id, imageType, onProgress, retryCount + 1)
      }

      const friendlyMessage = getUserFriendlyErrorMessage(error)
      throw new ImageUploadError(friendlyMessage, error.code, error)
    }
  }

  /**
   * Upload multiple item images
   */
  static async uploadMultipleItemImages(
    files: File[],
    projectName: string,
    itemId: string,
    onProgress?: (fileIndex: number, progress: UploadProgress) => void
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      try {
        const result = await this.uploadItemImage(file, projectName, itemId, onProgress ? (progress) => onProgress(i, progress) : undefined)
        results.push(result)
      } catch (error) {
        console.error(`Error uploading image ${i + 1}:`, error)
        throw error // Re-throw to stop the upload process
      }
    }

    return results
  }

  /**
   * Upload multiple transaction images (legacy method for backward compatibility)
   */
  static async uploadMultipleTransactionImages(
    files: File[],
    projectName: string,
    transactionId: string,
    onProgress?: (fileIndex: number, progress: UploadProgress) => void
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      try {
        const result = await this.uploadTransactionImage(file, projectName, transactionId, onProgress ? (progress) => onProgress(i, progress) : undefined)
        results.push(result)
      } catch (error) {
        console.error(`Error uploading image ${i + 1}:`, error)
        throw error // Re-throw to stop the upload process
      }
    }

    return results
  }

  /**
   * Upload multiple receipt images
   */
  static async uploadMultipleReceiptImages(
    files: File[],
    projectName: string,
    transactionId: string,
    onProgress?: (fileIndex: number, progress: UploadProgress) => void
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      try {
        const result = await this.uploadReceiptImage(file, projectName, transactionId, onProgress ? (progress) => onProgress(i, progress) : undefined)
        results.push(result)
      } catch (error) {
        console.error(`Error uploading receipt image ${i + 1}:`, error)
        throw error // Re-throw to stop the upload process
      }
    }

    return results
  }

  /**
   * Upload multiple other images
   */
  static async uploadMultipleOtherImages(
    files: File[],
    projectName: string,
    transactionId: string,
    onProgress?: (fileIndex: number, progress: UploadProgress) => void
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      try {
        const result = await this.uploadOtherImage(file, projectName, transactionId, onProgress ? (progress) => onProgress(i, progress) : undefined)
        results.push(result)
      } catch (error) {
        console.error(`Error uploading other image ${i + 1}:`, error)
        throw error // Re-throw to stop the upload process
      }
    }

    return results
  }

  /**
   * Delete an image from Supabase Storage
   * Note: Changed signature to accept bucket and fileName instead of imageUrl
   * for better compatibility with Supabase Storage API
   */
  static async deleteImage(bucket: string, fileName: string): Promise<void> {
    try {
      await this.ensureAuthentication()

      const { error } = await supabase.storage
        .from(bucket)
        .remove([fileName])

      if (error) throw error
    } catch (error) {
      console.error('Error deleting image:', error)
      throw new Error('Failed to delete image')
    }
  }

  /**
   * Delete multiple images
   * Note: Changed to accept array of {bucket, fileName} objects
   */
  static async deleteMultipleImages(images: Array<{ bucket: string; fileName: string }>): Promise<void> {
    const deletePromises = images.map(({ bucket, fileName }) => this.deleteImage(bucket, fileName))
    await Promise.all(deletePromises)
  }

  /**
   * Convert File objects to TransactionImage objects (legacy method for backward compatibility)
   */
  static convertFilesToTransactionImages(uploadResults: ImageUploadResult[]): TransactionImage[] {
    return uploadResults.map(result => ({
      url: result.url,
      fileName: result.fileName,
      uploadedAt: new Date(),
      size: result.size,
      mimeType: result.mimeType
    }))
  }

  /**
   * Convert File objects to receipt TransactionImage objects
   */
  static convertFilesToReceiptImages(uploadResults: ImageUploadResult[]): TransactionImage[] {
    return uploadResults.map(result => ({
      url: result.url,
      fileName: result.fileName,
      uploadedAt: new Date(),
      size: result.size,
      mimeType: result.mimeType
    }))
  }

  /**
   * Convert File objects to other TransactionImage objects
   */
  static convertFilesToOtherImages(uploadResults: ImageUploadResult[]): TransactionImage[] {
    return uploadResults.map(result => ({
      url: result.url,
      fileName: result.fileName,
      uploadedAt: new Date(),
      size: result.size,
      mimeType: result.mimeType
    }))
  }

  /**
   * Validate image file
   */
  static validateImageFile(file: File): boolean {
    // Check file type (allow common web image types plus HEIC/HEIF)
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif'
    ]

    // If the browser provides a MIME type, prefer that check
    if (file.type && allowedTypes.includes(file.type.toLowerCase())) {
      // Check file size (10MB limit)
      const maxSize = 10 * 1024 * 1024 // 10MB
      return file.size <= maxSize
    }

    // Fallback: check file extension if MIME type is missing or unrecognized
    const lowerName = file.name.toLowerCase()
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']
    const hasAllowedExtension = allowedExtensions.some(ext => lowerName.endsWith(ext))
    if (!hasAllowedExtension) return false

    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024 // 10MB
    return file.size <= maxSize
  }

  /**
   * Validate receipt attachment file (images + PDF)
   *
   * Note: Receipt attachments are stored in the `receipt-images` bucket for historical reasons.
   * This validator allows PDFs in addition to standard image formats.
   */
  static validateReceiptAttachmentFile(file: File): boolean {
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) return false

    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf'
    ]

    if (file.type && allowedTypes.includes(file.type.toLowerCase())) {
      return true
    }

    const lowerName = file.name.toLowerCase()
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.pdf']
    return allowedExtensions.some(ext => lowerName.endsWith(ext))
  }

  /**
   * Upload a receipt attachment (PDF or image) to Supabase Storage.
   *
   * This differs from `uploadReceiptImage` in that it does NOT enforce image-only validation,
   * enabling PDF invoice uploads (e.g., Wayfair invoice imports).
   */
  static async uploadReceiptAttachment(
    file: File,
    projectName: string,
    transactionId: string,
    onProgress?: (progress: UploadProgress) => void,
    retryCount: number = 0
  ): Promise<ImageUploadResult> {
    const MAX_RETRIES = 3

    console.log(`Receipt attachment upload attempt ${retryCount + 1}/${MAX_RETRIES + 1}`)

    await this.ensureAuthentication()

    const isStorageAvailable = await this.checkStorageAvailability()
    if (!isStorageAvailable) {
      throw new Error('Storage service is not available. Please check your connection and try again.')
    }

    if (!this.validateReceiptAttachmentFile(file)) {
      throw new Error('Invalid receipt attachment. Please upload a PDF or image under 10MB.')
    }

    const timestamp = Date.now()
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9-]/g, '_')
    const dateTime = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)

    // Store under a dedicated folder within the bucket for clarity.
    const fileName = `${sanitizedProjectName}/receipt-attachments/${dateTime}/${timestamp}_${sanitizedFileName}`

    try {
      const { data, error } = await supabase.storage
        .from('receipt-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (error) throw error

      const uploadedPath = data?.path || fileName

      if (onProgress) {
        onProgress({ loaded: file.size, total: file.size, percentage: 100 })
      }

      const { data: urlData } = supabase.storage
        .from('receipt-images')
        .getPublicUrl(uploadedPath)

      if (!urlData?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded file')
      }

      return {
        url: urlData.publicUrl,
        fileName: uploadedPath,
        size: file.size,
        mimeType: file.type || 'application/octet-stream'
      }
    } catch (error: any) {
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying receipt attachment upload (attempt ${retryCount + 2}/${MAX_RETRIES + 1})...`)
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)))
        return this.uploadReceiptAttachment(file, projectName, transactionId, onProgress, retryCount + 1)
      }

      const friendlyMessage = getUserFriendlyErrorMessage(error)
      throw new ImageUploadError(friendlyMessage, error.code, error)
    }
  }

  /**
   * Upload multiple receipt attachments (images + PDFs).
   *
   * - Images go through the existing image pipeline (compression/HEIC conversion).
   * - PDFs (and other non-image receipt attachments) are uploaded as-is.
   */
  static async uploadMultipleReceiptAttachments(
    files: File[],
    projectName: string,
    transactionId: string,
    onProgress?: (fileIndex: number, progress: UploadProgress) => void
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []

    const isPdfFile = (file: File) => {
      const mime = (file.type || '').toLowerCase()
      if (mime === 'application/pdf' || mime.includes('pdf')) return true
      return file.name.toLowerCase().endsWith('.pdf')
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const result = isPdfFile(file)
          ? await this.uploadReceiptAttachment(file, projectName, transactionId, onProgress ? (p) => onProgress(i, p) : undefined)
          : await this.uploadReceiptImage(file, projectName, transactionId, onProgress ? (p) => onProgress(i, p) : undefined)

        results.push(result)
      } catch (error) {
        console.error(`Error uploading receipt attachment ${i + 1}:`, error)
        throw error
      }
    }

    return results
  }

  /**
   * Get image metadata
   * Note: Supabase Storage provides basic metadata through the file API
   * This method returns basic info based on URL
   */
  static async getImageMetadata(imageUrl: string): Promise<any> {
    try {
      await this.ensureAuthentication()
      
      // Supabase Storage provides metadata through the file API
      return {
        name: imageUrl.split('/').pop() || '',
        fullPath: imageUrl,
        size: null,
        contentType: null,
        timeCreated: null,
        updated: null
      }
    } catch (error) {
      console.error('Error getting image metadata:', error)
      return null
    }
  }

  /**
   * Compress image for preview (client-side)
   */
  static compressImage(file: File, maxWidth: number = 800, quality: number = 0.8): Promise<File> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = img

        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height

        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              })
              resolve(compressedFile)
            } else {
              reject(new Error('Failed to compress image'))
            }
          },
          'image/jpeg',
          quality
        )
      }

      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = URL.createObjectURL(file)
    })
  }

  /**
   * Take photo using device camera
   */
  static takePhoto(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.capture = 'environment' // Use back camera on mobile

      input.onchange = (e) => {
        const target = e.target as HTMLInputElement
        const file = target.files?.[0] || null
        resolve(file)
      }

      input.click()
    })
  }

  /**
   * Select images from device gallery/camera roll
   */
  static selectFromGallery(): Promise<File[]> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = true
      // Note: capture attribute not set to allow gallery selection

      // Set up timeout to prevent infinite hanging
      // Increased to 5 minutes to give users time to find photos
      const timeoutId = setTimeout(() => {
        // Clean up the input element
        if (document.body.contains(input)) {
          document.body.removeChild(input)
        }
        reject(new Error('File selection timeout - user may have canceled'))
      }, 300000) // 5 minute timeout

      // Handle successful file selection
      const handleChange = (e: Event) => {
        clearTimeout(timeoutId) // Clear timeout on success
        if (document.body.contains(input)) {
          document.body.removeChild(input) // Clean up
        }

        const target = e.target as HTMLInputElement
        const files = target.files ? Array.from(target.files) : []
        resolve(files)
      }

      // Handle cleanup if component unmounts during selection
      const handleCancel = () => {
        clearTimeout(timeoutId)
        if (document.body.contains(input)) {
          document.body.removeChild(input)
        }
        reject(new Error('File selection canceled'))
      }

      // Set up event listeners
      input.onchange = handleChange
      input.addEventListener('cancel', handleCancel)

      // Add to DOM temporarily for proper event handling
      document.body.appendChild(input)
      input.click()
    })
  }

  /**
   * Create a preview URL for a file
   */
  static createPreviewUrl(file: File): string {
    if (typeof URL === 'undefined' || !URL.createObjectURL) {
      throw new Error('URL.createObjectURL is not available in this environment')
    }
    return URL.createObjectURL(file)
  }

  /**
   * Clean up preview URL to prevent memory leaks
   */
  static revokePreviewUrl(url: string): void {
    URL.revokeObjectURL(url)
  }

  /**
   * Check if file should be compressed for mobile upload
   */
  private static shouldCompressForMobile(file: File): boolean {
    // Check if we're on a mobile device and file is large
    const userAgent = navigator.userAgent.toLowerCase()
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent)
    const isTablet = /ipad|android(?!.*mobile)/i.test(userAgent)
    const isLargeFile = file.size > 2 * 1024 * 1024 // 2MB threshold
    const isMediumFile = file.size > 1024 * 1024 // 1MB threshold

    // Compress for mobile devices with large files, or tablets with very large files
    return (isMobile && isMediumFile) || (isTablet && isLargeFile)
  }

  /**
   * Compress file for mobile upload
   */
  private static async compressForMobile(file: File): Promise<File> {
    try {
      console.log(`Compressing file: ${file.name}, Size: ${file.size} bytes`)

      // Use aggressive compression for mobile
      const compressedFile = await this.compressImage(file, 1200, 0.7)

      console.log(`Compressed to: ${compressedFile.size} bytes (${Math.round((compressedFile.size / file.size) * 100)}% of original)`)

      return compressedFile
    } catch (error) {
      console.warn('Failed to compress file, using original:', error)
      return file // Return original file if compression fails
    }
  }
}
