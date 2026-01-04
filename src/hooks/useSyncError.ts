import { useState, useEffect } from 'react'
import { subscribeToSyncScheduler, getSyncSchedulerSnapshot } from '@/services/syncScheduler'
import { onSyncEvent, type SyncEventPayload } from '@/services/serviceWorker'

/**
 * Hook that returns whether a sync has failed.
 * Returns true if there's a sync scheduler error or background sync error.
 * Ignores "Waiting for network connectivity" which is just the offline state, not a failure.
 */
export function useSyncError(): boolean {
  const [schedulerError, setSchedulerError] = useState<string | null>(() => {
    const snapshot = getSyncSchedulerSnapshot()
    const error = snapshot.lastError
    // Ignore "Waiting for network connectivity" - that's just being offline, not a sync failure
    return error && error !== 'Waiting for network connectivity' ? error : null
  })
  const [backgroundSyncError, setBackgroundSyncError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribeScheduler = subscribeToSyncScheduler(snapshot => {
      const error = snapshot.lastError
      // Ignore "Waiting for network connectivity" - that's just being offline, not a sync failure
      setSchedulerError(error && error !== 'Waiting for network connectivity' ? error : null)
    })

    const handleError = (payload: SyncEventPayload) => {
      if (payload.source === 'background-sync') {
        setBackgroundSyncError(payload.error || 'Background sync failed')
      }
    }

    const handleComplete = (payload: SyncEventPayload) => {
      if (payload.source === 'background-sync') {
        setBackgroundSyncError(null)
      }
    }

    const offError = onSyncEvent('error', handleError)
    const offComplete = onSyncEvent('complete', handleComplete)

    return () => {
      unsubscribeScheduler()
      offError()
      offComplete()
    }
  }, [])

  return Boolean(schedulerError || backgroundSyncError)
}
