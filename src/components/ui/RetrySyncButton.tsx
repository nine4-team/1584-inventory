import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { operationQueue } from '@/services/operationQueue'
import { triggerManualSync } from '@/services/serviceWorker'
import { requestForegroundSync } from '@/services/syncScheduler'
import { clsx } from 'clsx'

interface RetrySyncButtonProps {
  className?: string
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  label?: string
  showPendingCount?: boolean
}

export function RetrySyncButton({
  className,
  variant = 'secondary',
  size = 'sm',
  label = 'Retry sync',
  showPendingCount = true
}: RetrySyncButtonProps) {
  const initialSnapshot = operationQueue.getSnapshot()
  const [pendingCount, setPendingCount] = useState(initialSnapshot.length)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastOfflineEnqueueAt, setLastOfflineEnqueueAt] = useState<string | null>(null)
  const [lastEnqueueError, setLastEnqueueError] = useState<string | null>(null)
  const [backgroundSyncAvailable, setBackgroundSyncAvailable] = useState<boolean | null>(
    initialSnapshot.backgroundSyncAvailable ?? null
  )
  const [backgroundSyncReason, setBackgroundSyncReason] = useState<string | null>(
    initialSnapshot.backgroundSyncReason ?? null
  )

  useEffect(() => {
    const unsubscribe = operationQueue.subscribe(snapshot => {
      setPendingCount(snapshot.length)
      setLastOfflineEnqueueAt(snapshot.lastOfflineEnqueueAt)
      setLastEnqueueError(snapshot.lastEnqueueError)
      setBackgroundSyncAvailable(snapshot.backgroundSyncAvailable)
      setBackgroundSyncReason(snapshot.backgroundSyncReason)
    })
    return () => unsubscribe()
  }, [])

  const handleRetry = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    setError(null)

    try {
      await triggerManualSync()
    } catch (manualError) {
      console.warn('Manual sync trigger failed', manualError)
    }

    try {
      await requestForegroundSync('manual')
    } catch (foregroundError) {
      console.warn('Foreground sync request failed', foregroundError)
      setError('Retry failed — please check your connection and try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <Button
        variant={variant}
        size={size}
        onClick={handleRetry}
        disabled={isProcessing}
        className="inline-flex items-center gap-2"
      >
        {isProcessing && <RefreshCw className="w-4 h-4 animate-spin" />}
        <span>{label}</span>
        {showPendingCount && pendingCount > 0 && (
          <span className="text-xs font-normal text-gray-600">({pendingCount} pending)</span>
        )}
      </Button>
      {lastOfflineEnqueueAt && pendingCount > 0 && (
        <p className="text-xs text-amber-600">
          Offline save queued at {formatQueueTimestamp(lastOfflineEnqueueAt)}
        </p>
      )}
      {backgroundSyncAvailable === false && (
        <p className="text-xs text-amber-600">
          {formatBackgroundSyncWarning(backgroundSyncReason)}
        </p>
      )}
      {(error || lastEnqueueError) && (
        <p className="text-xs text-red-600">
          {error ?? lastEnqueueError}
        </p>
      )}
    </div>
  )
}

function formatQueueTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatBackgroundSyncWarning(reason: string | null): string {
  switch (reason) {
    case 'no-controller':
      return 'Background sync failed — reload to activate the service worker.'
    case 'ready-timeout':
      return 'Background sync failed to initialize — keep Ledger open to sync.'
    case 'unsupported':
      return 'Background sync unsupported in this browser. Keep Ledger open to sync.'
    default:
      return reason
        ? `Background sync unavailable (${reason}). Keep Ledger open or retry manually.`
        : 'Background sync unavailable. Keep Ledger open or retry manually.'
  }
}
