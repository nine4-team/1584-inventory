import { useMemo } from 'react'
import { useNetworkState } from '../hooks/useNetworkState'
import { Wifi, WifiOff, AlertTriangle, Activity } from 'lucide-react'
import { useProjectRealtimeOverview } from '@/contexts/ProjectRealtimeContext'

type ChannelWarning = {
  projectId: string
  projectName: string
  stale: boolean
  disconnected: boolean
  telemetry: {
    lastCollectionsRefreshAt: number | null
    lastDisconnectAt: number | null
    lastDisconnectReason: string | null
  }
}

export function NetworkStatus() {
  const { isOnline, isSlowConnection } = useNetworkState()
  const { snapshots } = useProjectRealtimeOverview()
  const now = Date.now()
  const CHANNEL_STALE_THRESHOLD_MS = 120_000
  const DISCONNECT_WARNING_DELAY_MS = 10_000

  const channelWarnings = useMemo<ChannelWarning[]>(() => {
    return Object.entries(snapshots)
      .map(([projectId, snapshot]) => {
        const telemetry = snapshot.telemetry
        if (!telemetry) return null
        const stale =
          telemetry.activeChannelCount > 0 &&
          (!telemetry.lastCollectionsRefreshAt ||
            now - telemetry.lastCollectionsRefreshAt > CHANNEL_STALE_THRESHOLD_MS)
        const disconnected =
          Boolean(telemetry.lastDisconnectReason) &&
          telemetry.lastDisconnectAt !== null &&
          now - telemetry.lastDisconnectAt > DISCONNECT_WARNING_DELAY_MS
        if (!stale && !disconnected) return null
        return {
          projectId,
          projectName: snapshot.project?.projectName || snapshot.project?.name || projectId,
          stale,
          disconnected,
          telemetry: {
            lastCollectionsRefreshAt: telemetry.lastCollectionsRefreshAt,
            lastDisconnectAt: telemetry.lastDisconnectAt,
            lastDisconnectReason: telemetry.lastDisconnectReason,
          },
        }
      })
      .filter((entry): entry is ChannelWarning => Boolean(entry))
  }, [snapshots, now])

  const shouldShow =
    !isOnline || isSlowConnection || channelWarnings.length > 0

  if (!shouldShow) {
    return null // Nothing to show
  }

  const variant = !isOnline ? 'offline' : isSlowConnection ? 'slow' : 'channel'
  const variantClasses: Record<typeof variant, string> = {
    offline: 'bg-red-50 text-red-800 border-b border-red-200',
    slow: 'bg-yellow-50 text-yellow-800 border-b border-yellow-200',
    channel: 'bg-orange-50 text-orange-900 border-b border-orange-200',
  }

  const formatRelative = (timestamp: number | null) => {
    if (!timestamp) return 'never'
    const diff = Math.max(0, now - timestamp)
    if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
    const minutes = Math.round(diff / 60_000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    return `${hours}h ago`
  }

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium ${variantClasses[variant]}`}>
      <div className="flex items-center gap-2">
        {!isOnline && (
          <>
            <WifiOff className="w-4 h-4" />
            Offline - Changes will sync when reconnected
          </>
        )}
        {isOnline && isSlowConnection && (
          <>
            <Wifi className="w-4 h-4" />
            Slow connection detected
            <AlertTriangle className="w-4 h-4 ml-1" />
          </>
        )}
        {isOnline && !isSlowConnection && channelWarnings.length > 0 && (
          <>
            <Activity className="w-4 h-4" />
            Realtime constraints detected
          </>
        )}
        {isSlowConnection && (
          <AlertTriangle className="w-4 h-4 ml-2" />
        )}
      </div>
      {channelWarnings.length > 0 && (
        <ul className="mt-1 text-xs space-y-0.5">
          {channelWarnings.map(({ projectId, projectName, telemetry, stale, disconnected }) => (
            <li key={projectId}>
              <span className="font-semibold">{projectName ?? projectId}</span>
              {stale && (
                <span>{' · last refresh '}{formatRelative(telemetry.lastCollectionsRefreshAt)}</span>
              )}
              {disconnected && telemetry.lastDisconnectReason && (
                <span>{' · '}{telemetry.lastDisconnectReason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}