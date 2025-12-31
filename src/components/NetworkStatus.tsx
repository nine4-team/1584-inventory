import { useMemo, useEffect } from 'react'
import { useNetworkState } from '../hooks/useNetworkState'
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react'
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
    lastItemsRefreshAt: number | null
    lastTransactionsRefreshAt: number | null
  }
  latestRefreshAt: number | null
}

export function NetworkStatus() {
  const { isOnline, isSlowConnection } = useNetworkState()
  const { snapshots } = useProjectRealtimeOverview()
  const now = Date.now()
  const CHANNEL_STALE_THRESHOLD_MS = 120_000
  const DISCONNECT_WARNING_DELAY_MS = 10_000

  const channelWarnings = useMemo<ChannelWarning[]>(() => {
    const getLatestActivityTimestamp = (telemetry: ChannelWarning['telemetry']) => {
      const timestamps = [
        telemetry.lastCollectionsRefreshAt,
        telemetry.lastItemsRefreshAt,
        telemetry.lastTransactionsRefreshAt,
      ].filter((value): value is number => typeof value === 'number')
      return timestamps.length > 0 ? Math.max(...timestamps) : null
    }

    return Object.entries(snapshots)
      .map(([projectId, snapshot]) => {
        const telemetry = snapshot.telemetry
        if (!telemetry) return null
        const latestRefreshAt = getLatestActivityTimestamp({
          lastCollectionsRefreshAt: telemetry.lastCollectionsRefreshAt,
          lastItemsRefreshAt: telemetry.lastItemsRefreshAt,
          lastTransactionsRefreshAt: telemetry.lastTransactionsRefreshAt,
          lastDisconnectAt: telemetry.lastDisconnectAt,
          lastDisconnectReason: telemetry.lastDisconnectReason,
        })
        const stale =
          telemetry.activeChannelCount > 0 &&
          (!latestRefreshAt || now - latestRefreshAt > CHANNEL_STALE_THRESHOLD_MS)
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
            lastItemsRefreshAt: telemetry.lastItemsRefreshAt,
            lastTransactionsRefreshAt: telemetry.lastTransactionsRefreshAt,
          },
          latestRefreshAt,
        }
      })
      .filter((entry): entry is ChannelWarning => Boolean(entry))
  }, [snapshots, now])

  useEffect(() => {
    if (channelWarnings.length > 0) {
      // console.warn('[NetworkStatus] Realtime channels inactive or disconnected', channelWarnings)
    }
  }, [channelWarnings])

  const shouldShow = !isOnline || isSlowConnection

  if (!shouldShow) {
    return null // Nothing to show
  }

  const variant = !isOnline ? 'offline' : 'slow'
  const variantClasses: Record<typeof variant, string> = {
    offline: 'bg-red-50 text-red-800 border-b border-red-200',
    slow: 'bg-yellow-50 text-yellow-800 border-b border-yellow-200',
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
        {isSlowConnection && (
          <AlertTriangle className="w-4 h-4 ml-2" />
        )}
      </div>
    </div>
  )
}