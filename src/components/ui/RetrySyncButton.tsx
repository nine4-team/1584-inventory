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
  const [pendingCount, setPendingCount] = useState(() => operationQueue.getQueueLength())
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = operationQueue.subscribe(snapshot => {
      setPendingCount(snapshot.length)
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
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
