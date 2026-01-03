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
 * Uses clear language to indicate item is queued, not fully saved
 */
export function getOfflineSaveMessage(): string {
  return 'Item queued for sync · will be saved when online'
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
