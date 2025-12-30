import { useNetworkState } from '../hooks/useNetworkState'
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react'

export function NetworkStatus() {
  const { isOnline, isSlowConnection } = useNetworkState()

  if (isOnline && !isSlowConnection) {
    return null // Don't show anything when everything is fine
  }

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium ${
      isOnline
        ? 'bg-yellow-50 text-yellow-800 border-b border-yellow-200'
        : 'bg-red-50 text-red-800 border-b border-red-200'
    }`}>
      <div className="flex items-center gap-2">
        {isOnline ? (
          <>
            <Wifi className="w-4 h-4" />
            {isSlowConnection ? 'Slow connection' : 'Online'}
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            Offline - Changes will sync when reconnected
          </>
        )}
        {isSlowConnection && (
          <AlertTriangle className="w-4 h-4 ml-2" />
        )}
      </div>
    </div>
  )
}