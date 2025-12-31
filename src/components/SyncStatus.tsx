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
  const [refreshingProjects, setRefreshingProjects] = useState<Set<string>>(new Set())
  const { hasActiveRealtimeChannels, isRealtimeConnected, realtimeStatus } = useRealtimeConnectionStatus()
  const { snapshots, refreshCollections } = useProjectRealtimeOverview()
  const shouldShowRealtimeWarning = hasActiveRealtimeChannels && !isRealtimeConnected
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

  const formatRelative = (timestamp: number | null) => {
    if (!timestamp) return 'never'
    const diff = Math.max(0, now - timestamp)
    if (diff < 1000) return 'just now'
    if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
    const minutes = Math.round(diff / 60_000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    return `${hours}h ago`
  }

  const handleProjectRefresh = async (projectId: string) => {
    setRefreshingProjects(prev => {
      const next = new Set(prev)
      next.add(projectId)
      return next
    })
    try {
      await refreshCollections(projectId, { includeProject: true })
    } catch (error) {
      console.debug('SyncStatus: manual project refresh failed', error)
    } finally {
      setRefreshingProjects(prev => {
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
    }
  }

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

  if (queueLength === 0 && !isSyncing && !lastSyncError && !shouldShowRealtimeWarning) {
    return null // Nothing to show
  }

  type StatusVariant = 'error' | 'realtime' | 'syncing' | 'queue' | 'success'
  let statusVariant: StatusVariant = 'success'

  if (lastSyncError) {
    statusVariant = 'error'
  } else if (shouldShowRealtimeWarning) {
    statusVariant = 'realtime'
  } else if (isSyncing) {
    statusVariant = 'syncing'
  } else if (queueLength > 0) {
    statusVariant = 'queue'
  }

  const variantClasses: Record<StatusVariant, string> = {
    error: 'bg-red-50 text-red-800 border border-red-200',
    realtime: 'bg-orange-50 text-orange-900 border border-orange-200',
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
      case 'realtime':
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

        {shouldShowRealtimeWarning && projectsNeedingAttention.length > 0 && (
          <div className="mt-2 text-xs">
            <p className="font-semibold mb-1">Realtime paused on:</p>
            <ul className="space-y-1">
              {projectsNeedingAttention.map(({ projectId, projectName, telemetry }) => (
                <li key={projectId} className="flex items-center gap-2 justify-between">
                  <span className="flex-1">
                    <span>
                      {projectName ?? projectId} · {telemetry?.activeChannelCount ?? 0} chan /
                      {' '}
                      {telemetry?.lineageSubscriptionCount ?? 0} lineage
                    </span>
                    <span className="block text-[11px] text-orange-900/80">
                      Last refresh {formatRelative(telemetry?.lastCollectionsRefreshAt ?? null)}
                      {telemetry?.lastDisconnectReason && telemetry.lastDisconnectAt
                        ? ` · ${telemetry.lastDisconnectReason}`
                        : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => handleProjectRefresh(projectId)}
                    disabled={refreshingProjects.has(projectId)}
                    className="px-2 py-0.5 text-[11px] bg-white/80 border rounded hover:bg-white disabled:opacity-60"
                  >
                    Refresh
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}