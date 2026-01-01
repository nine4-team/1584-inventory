/**
 * Centralized offline UX feedback utilities
 * Provides consistent messaging and retry actions for offline operations
 */

import { useToast } from '@/components/ui/ToastContext'

export interface OfflineOperationResult {
  operationId: string | null
  wasQueued: boolean
}

/**
 * Get the standard offline save message
 */
export function getOfflineSaveMessage(): string {
  return 'Saved offline · will sync automatically'
}

/**
 * Hook to show offline save feedback
 * Components should use this hook to show consistent offline messaging
 * 
 * Usage:
 * ```tsx
 * const { showOfflineSaved } = useOfflineFeedback()
 * 
 * // After queuing an operation:
 * showOfflineSaved(operationId)
 * ```
 */
export function useOfflineFeedback() {
  const { showSuccess } = useToast()

  const showOfflineSaved = (operationId: string | null = null) => {
    showSuccess(getOfflineSaveMessage())
  }

  return { showOfflineSaved }
}
