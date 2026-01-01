import React, { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { offlineMediaService } from '@/services/offlineMediaService'

interface StorageQuotaWarningProps {
  className?: string
}

export function StorageQuotaWarning({ className = '' }: StorageQuotaWarningProps) {
  const [storageStatus, setStorageStatus] = useState<{
    usedBytes: number
    totalBytes: number
    usagePercent: number
    canUpload: boolean
  } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const checkStorage = async () => {
      try {
        const status = await offlineMediaService.getStorageStatus()
        setStorageStatus(status)
      } catch (error) {
        console.error('Failed to check storage quota:', error)
      }
    }

    checkStorage()
    // Check every 30 seconds
    const interval = setInterval(checkStorage, 30000)

    return () => clearInterval(interval)
  }, [])

  if (!storageStatus || dismissed || storageStatus.usagePercent < 80) {
    return null
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isWarning = storageStatus.usagePercent >= 80 && storageStatus.usagePercent < 90
  const isCritical = storageStatus.usagePercent >= 90

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 ${
        isCritical
          ? 'border-red-500 bg-red-50 text-red-900'
          : 'border-yellow-500 bg-yellow-50 text-yellow-900'
      } ${className}`}
    >
      <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${isCritical ? 'text-red-600' : 'text-yellow-600'}`} />
      <div className="flex-1">
        <p className="text-sm font-medium">
          {isCritical ? 'Storage nearly full' : 'Storage usage high'}
        </p>
        <p className="text-xs">
          Using {formatBytes(storageStatus.usedBytes)} of {formatBytes(storageStatus.totalBytes)} (
          {storageStatus.usagePercent}%)
        </p>
        {isCritical && (
          <p className="mt-1 text-xs">
            Please delete some media files or free up space before uploading more.
          </p>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 text-gray-500 hover:text-gray-700"
        aria-label="Dismiss warning"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
