import { AlertCircle, RefreshCw } from 'lucide-react'
import { useOfflinePrerequisites, OfflinePrerequisiteStatus } from '@/hooks/useOfflinePrerequisites'
import { RetrySyncButton } from './RetrySyncButton'

interface OfflinePrerequisiteBannerProps {
  className?: string
  showRetryButton?: boolean
}

/**
 * Banner component that displays offline prerequisite status
 * Shows warnings when budget categories or tax presets are not cached
 */
export function OfflinePrerequisiteBanner({ 
  className = '', 
  showRetryButton = true 
}: OfflinePrerequisiteBannerProps) {
  const { status, blockingReason, hydrateNow, budgetCategories, taxPresets } = useOfflinePrerequisites()

  // Don't show anything if ready
  if (status === 'ready') {
    return null
  }

  const isBlocked = status === 'blocked'
  const isWarming = status === 'warming'

  return (
    <div
      className={`rounded-lg border-2 p-4 ${
        isBlocked
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-yellow-50 border-yellow-200 text-yellow-800'
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
          isBlocked ? 'text-red-600' : 'text-yellow-600'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {blockingReason || 'Offline prerequisites not ready'}
          </p>
          {isWarming && (
            <div className="flex items-center gap-2 mt-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-xs">Syncing metadata...</span>
            </div>
          )}
          {isBlocked && showRetryButton && (
            <div className="mt-3">
              <RetrySyncButton 
                size="sm" 
                variant="secondary"
                label="Retry sync"
                showPendingCount={false}
                className="inline-flex"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Hook that returns whether the form should be disabled due to missing prerequisites
 */
export function useOfflinePrerequisiteGate() {
  const { isReady, status, blockingReason } = useOfflinePrerequisites()
  
  return {
    isReady,
    isBlocked: status === 'blocked',
    isWarming: status === 'warming',
    blockingReason
  }
}
