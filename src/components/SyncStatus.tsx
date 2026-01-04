import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { operationQueue } from '../services/operationQueue'
import { onSyncEvent, type SyncEventPayload } from '../services/serviceWorker'
import { useRealtimeConnectionStatus } from '@/hooks/useRealtimeConnectionStatus'
import { useProjectRealtimeOverview } from '@/contexts/ProjectRealtimeContext'
import { subscribeToSyncScheduler, getSyncSchedulerSnapshot, type SyncSchedulerSnapshot } from '@/services/syncScheduler'
import { RetrySyncButton } from './ui/RetrySyncButton'
import { useNetworkState } from '@/hooks/useNetworkState'

export function SyncStatus() {
  const [queueLength, setQueueLength] = useState(0)
  const [backgroundSyncActive, setBackgroundSyncActive] = useState(false)
  const [backgroundSyncError, setBackgroundSyncError] = useState<string | null>(null)
  const [lastSyncSource, setLastSyncSource] = useState<string | null>(null)
  const [pendingFromWorker, setPendingFromWorker] = useState<number | null>(null)
  const [schedulerSnapshot, setSchedulerSnapshot] = useState<SyncSchedulerSnapshot>(() =>
    getSyncSchedulerSnapshot()
  )
  const { realtimeStatus, lastDisconnectedAt } = useRealtimeConnectionStatus()
  const { snapshots } = useProjectRealtimeOverview()
  const { isOnline } = useNetworkState()
  const now = Date.now()

  const telemetryEntries = useMemo(() => {
    return Object.entries(snapshots).map(([projectId, snapshot]) => ({
      projectId,
      projectName: snapshot.project?.projectName || snapshot.project?.name || projectId,
      telemetry: snapshot.telemetry,
    }))
  }, [snapshots])

  const STALE_THRESHOLD_MS = 60_000
  const DISCONNECT_WARNING_DELAY_MS = 10_000
  const projectsNeedingAttention = telemetryEntries.filter(entry => {
    const { telemetry } = entry
    if (!telemetry) return false
    const hasChannels = telemetry.activeChannelCount > 0 || telemetry.lineageSubscriptionCount > 0
    const staleCollections =
      hasChannels &&
      (!telemetry.lastCollectionsRefreshAt || now - telemetry.lastCollectionsRefreshAt > STALE_THRESHOLD_MS)
    const disconnectWarning =
      Boolean(telemetry.lastDisconnectReason) &&
      telemetry.lastDisconnectAt !== null &&
      now - telemetry.lastDisconnectAt > DISCONNECT_WARNING_DELAY_MS
    return staleCollections || disconnectWarning
  })

  useEffect(() => {
    if (projectsNeedingAttention.length > 0) {
      // console.warn('[SyncStatus] Realtime channels inactive', {
      //   projects: projectsNeedingAttention,
      //   realtimeStatus,
      //   lastDisconnectedAt,
      // })
    }
  }, [projectsNeedingAttention, realtimeStatus, lastDisconnectedAt])

  useEffect(() => {
    const unsubscribeQueue = operationQueue.subscribe(snapshot => {
      setQueueLength(snapshot.length)
    })

    const unsubscribeScheduler = subscribeToSyncScheduler(snapshot => {
      setSchedulerSnapshot(snapshot)
    })

    const handleProgress = (payload: SyncEventPayload) => {
      if (payload.source === 'background-sync') {
        setBackgroundSyncActive(true)
        setBackgroundSyncError(null)
      }
      setLastSyncSource(payload.source ?? null)
      setPendingFromWorker(
        typeof payload.pendingOperations === 'number' ? payload.pendingOperations : null
      )
    }

    const handleComplete = (payload: SyncEventPayload) => {
      if (payload.source === 'background-sync') {
        setBackgroundSyncActive(false)
        setBackgroundSyncError(null)
      }
      setQueueLength(operationQueue.getQueueLength())
      setLastSyncSource(payload.source ?? null)
      setPendingFromWorker(
        typeof payload.pendingOperations === 'number' ? payload.pendingOperations : null
      )
    }

    const handleError = (payload: SyncEventPayload) => {
      if (payload.source === 'background-sync') {
        setBackgroundSyncActive(false)
        setBackgroundSyncError(payload.error || 'Background sync failed')
      }
      setLastSyncSource(payload.source ?? null)
      setPendingFromWorker(
        typeof payload.pendingOperations === 'number' ? payload.pendingOperations : null
      )
    }

    const offProgress = onSyncEvent('progress', handleProgress)
    const offComplete = onSyncEvent('complete', handleComplete)
    const offError = onSyncEvent('error', handleError)

    return () => {
      unsubscribeScheduler()
      offProgress()
      offComplete()
      offError()
      unsubscribeQueue()
    }
  }, [])

  const schedulerError =
    schedulerSnapshot.lastError && schedulerSnapshot.lastError !== 'Waiting for network connectivity'
      ? schedulerSnapshot.lastError
      : null
  const combinedError = backgroundSyncError || schedulerError
  const isForegroundSyncing = schedulerSnapshot.isRunning
  const isRetryScheduled =
    schedulerSnapshot.nextRunAt !== null && schedulerSnapshot.nextRunAt > Date.now()

  useEffect(() => {
    if (queueLength === 0) {
      setPendingFromWorker(null)
    }
  }, [queueLength])

  const effectivePendingCount =
    typeof pendingFromWorker === 'number' ? pendingFromWorker : queueLength

  const shouldShowBanner =
    effectivePendingCount > 0 || isForegroundSyncing || backgroundSyncActive || Boolean(combinedError)

  if (!shouldShowBanner) {
    return null // Nothing to show
  }

  type StatusVariant = 'error' | 'syncing' | 'queue' | 'waiting'
  let statusVariant: StatusVariant = 'queue'

  if (combinedError) {
    statusVariant = 'error'
  } else if (isForegroundSyncing || backgroundSyncActive) {
    statusVariant = 'syncing'
  } else if (queueLength > 0 && isRetryScheduled) {
    statusVariant = 'waiting'
  }

  const variantClasses: Record<StatusVariant, string> = {
    error: 'bg-red-50 text-red-800 border border-red-200',
    syncing: 'bg-blue-50 text-blue-800 border border-blue-200',
    queue: 'bg-yellow-50 text-yellow-800 border border-yellow-200',
    waiting: 'bg-amber-50 text-amber-800 border border-amber-200'
  }

  const statusMessage = (() => {
    switch (statusVariant) {
      case 'error':
        return `Sync error: ${combinedError}`
      case 'syncing':
        return 'Syncing changes…'
      case 'queue':
        // Show user-friendly message based on network status
        if (!isOnline) {
          return 'Changes will sync when you\'re back online'
        }
        return `${effectivePendingCount} change${effectivePendingCount === 1 ? '' : 's'} pending`
      case 'waiting':
        // Simplified message - don't show countdown timer in main message
        if (!isOnline) {
          return 'Changes will sync when you\'re back online'
        }
        return `${effectivePendingCount} change${effectivePendingCount === 1 ? '' : 's'} pending`
      default:
        return 'Sync status unavailable'
    }
  })()

  const statusIcon = (() => {
    switch (statusVariant) {
      case 'error':
        return <AlertCircle className="w-4 h-4" />
      case 'syncing':
        return <RefreshCw className="w-4 h-4 animate-spin" />
      case 'queue':
        return <RefreshCw className="w-4 h-4" />
      case 'waiting':
        return <RefreshCw className="w-4 h-4 text-amber-600" />
      default:
        return <CheckCircle className="w-4 h-4" />
    }
  })()

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${variantClasses[statusVariant]}`}>
        <div className="flex items-center gap-2">
          {statusIcon}

          <span>{statusMessage}</span>

          {combinedError && statusVariant === 'error' && (
            <RetrySyncButton className="ml-2" size="sm" showPendingCount />
          )}
        </div>
      </div>
    </div>
  )
}