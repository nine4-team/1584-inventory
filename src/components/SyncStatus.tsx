import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { operationQueue } from '../services/operationQueue'
import { onSyncComplete, triggerManualSync } from '../services/serviceWorker'
import { useRealtimeConnectionStatus } from '@/hooks/useRealtimeConnectionStatus'
import { useProjectRealtimeOverview } from '@/contexts/ProjectRealtimeContext'

export function SyncStatus() {
  const [queueLength, setQueueLength] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)
  const { hasActiveRealtimeChannels, isRealtimeConnected, realtimeStatus, lastDisconnectedAt } =
    useRealtimeConnectionStatus()
  const { snapshots } = useProjectRealtimeOverview()
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
    const updateStatus = () => {
      setQueueLength(operationQueue.getQueueLength())
    }

    // Update immediately
    updateStatus()

    // Check periodically for queue status
    const interval = setInterval(updateStatus, 2000)

    // Listen for sync complete messages from service worker
    const cleanup = onSyncComplete(() => {
      setIsSyncing(false)
      setLastSyncError(null)
      updateStatus()
    })

    return () => {
      clearInterval(interval)
      cleanup()
    }
  }, [])

  const handleManualSync = async () => {
    setIsSyncing(true)
    setLastSyncError(null)

    try {
      await triggerManualSync()
      // Also trigger foreground processing as backup
      await operationQueue.processQueue()
      setIsSyncing(false)
    } catch (error) {
      setIsSyncing(false)
      setLastSyncError('Manual sync failed')
    }
  }

  if (queueLength === 0 && !isSyncing && !lastSyncError) {
    return null // Nothing to show
  }

  type StatusVariant = 'error' | 'syncing' | 'queue' | 'success'
  let statusVariant: StatusVariant = 'success'

  if (lastSyncError) {
    statusVariant = 'error'
  } else if (isSyncing) {
    statusVariant = 'syncing'
  } else if (queueLength > 0) {
    statusVariant = 'queue'
  }

  const variantClasses: Record<StatusVariant, string> = {
    error: 'bg-red-50 text-red-800 border border-red-200',
    syncing: 'bg-blue-50 text-blue-800 border border-blue-200',
    queue: 'bg-yellow-50 text-yellow-800 border border-yellow-200',
    success: 'bg-green-50 text-green-800 border border-green-200',
  }

  const statusMessage = (() => {
    switch (statusVariant) {
      case 'error':
        return `Sync error: ${lastSyncError}`
      case 'realtime':
        return realtimeStatus === 'connecting'
          ? 'Connecting to Supabase realtime...'
          : 'Live updates paused — reconnecting to Supabase'
      case 'syncing':
        return 'Syncing changes...'
      case 'queue':
        return `${queueLength} change${queueLength === 1 ? '' : 's'} pending`
      default:
        return 'All changes synced'
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

          {statusVariant === 'queue' && !isSyncing && (
            <button
              onClick={handleManualSync}
              className="ml-2 px-2 py-1 text-xs bg-white rounded border hover:bg-gray-50"
            >
              Sync now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}