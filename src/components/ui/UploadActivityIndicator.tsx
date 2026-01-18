import React from 'react'

interface UploadActivityIndicatorProps {
  isUploading: boolean
  progress?: number
  label?: string
  className?: string
}

export default function UploadActivityIndicator({
  isUploading,
  progress,
  label = 'Uploading',
  className = ''
}: UploadActivityIndicatorProps) {
  if (!isUploading) return null

  const showProgress = typeof progress === 'number' && progress > 0 && progress < 100
  const text = showProgress ? `${label} ${Math.round(progress)}%` : label

  return (
    <span className={`inline-flex items-center text-xs text-gray-500 ${className}`}>
      <span className="mr-1 h-2 w-2 rounded-full bg-primary-500 opacity-70 animate-pulse" aria-hidden="true" />
      <span>{text}</span>
    </span>
  )
}
