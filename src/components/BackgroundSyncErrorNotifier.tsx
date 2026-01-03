import { useEffect, useRef } from 'react'
import { onSyncEvent, type SyncEventPayload } from '../services/serviceWorker'
import { useToast } from './ui/ToastContext'

/**
 * Component that listens for background sync errors and displays toast notifications.
 * This surfaces failures that would otherwise be silent.
 */
export function BackgroundSyncErrorNotifier() {
  const { showError, showWarning } = useToast()
  const lastErrorRef = useRef<string | null>(null)
  const lastErrorTimeRef = useRef<number>(0)
  const ERROR_DEBOUNCE_MS = 5000 // Don't show same error more than once per 5 seconds

  useEffect(() => {
    const handleError = (payload: SyncEventPayload) => {
      // Only show errors from background sync (not foreground/manual)
      if (payload.source !== 'background-sync') {
        return
      }

      const errorMessage = payload.error || 'Background sync failed'
      const now = Date.now()

      // Debounce: don't show the same error repeatedly
      if (
        lastErrorRef.current === errorMessage &&
        now - lastErrorTimeRef.current < ERROR_DEBOUNCE_MS
      ) {
        return
      }

      lastErrorRef.current = errorMessage
      lastErrorTimeRef.current = now

      // Show appropriate toast based on error type
      if (errorMessage.includes('offline') || errorMessage.includes('Network offline')) {
        // Network offline is expected, show as warning
        showWarning(errorMessage, 6000)
      } else {
        // Other errors are unexpected, show as error
        showError(errorMessage, 8000)
      }
    }

    const unsubscribe = onSyncEvent('error', handleError)

    return unsubscribe
  }, [showError, showWarning])

  // This component doesn't render anything
  return null
}
