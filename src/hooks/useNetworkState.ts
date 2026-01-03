import { useEffect, useState } from 'react'
import {
  getNetworkStatusSnapshot,
  initNetworkStatusService,
  subscribeToNetworkStatus,
  type NetworkStatusSnapshot
} from '../services/networkStatusService'

export function useNetworkState(): NetworkStatusSnapshot {
  const [networkState, setNetworkState] = useState<NetworkStatusSnapshot>(() => getNetworkStatusSnapshot())

  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    initNetworkStatusService().then(() => {
      unsubscribe = subscribeToNetworkStatus(setNetworkState)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return networkState
}