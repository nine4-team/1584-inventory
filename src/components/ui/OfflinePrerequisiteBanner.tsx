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

  // Log to console but never show in UI
  if (status !== 'ready' && blockingReason) {
    console.log('[OfflinePrerequisiteBanner]', { status, blockingReason, budgetCategories, taxPresets })
  }

  // Never show banner in UI - only log to console
  return null
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
