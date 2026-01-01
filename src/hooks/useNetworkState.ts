import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { reportNetworkStatus } from '../services/syncScheduler'

interface NetworkState {
  isOnline: boolean
  isSlowConnection: boolean
  lastOnline: Date | null
  connectionType: string
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export function useNetworkState(): NetworkState {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isOnline: navigator.onLine,
    isSlowConnection: false,
    lastOnline: navigator.onLine ? new Date() : null,
    connectionType: 'unknown'
  })

  useEffect(() => {
    let lastOnlineTime = networkState.lastOnline

    const updateNetworkState = async () => {
      const isOnline = navigator.onLine

      let isSlowConnection = false
      let connectionType = 'unknown'

      // Check connection quality if Network Information API is available
      if ('connection' in navigator) {
        const conn = (navigator as any).connection
        connectionType = conn.effectiveType || 'unknown'
        isSlowConnection = conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g'
      }

      // Test actual connectivity with a local ping endpoint first
      let actualOnline = isOnline
      if (isOnline) {
        try {
          const cacheBuster = Date.now()
          const response = await fetch(`/ping.json?cb=${cacheBuster}`, {
            method: 'GET',
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
          })
          actualOnline = response.ok
        } catch {
          actualOnline = false

          // Optional fallback: call Supabase ping edge function when enabled
          if (SUPABASE_URL) {
            try {
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token

              if (token) {
                const response = await fetch(`${SUPABASE_URL}/functions/v1/ping`, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  cache: 'no-store',
                  signal: AbortSignal.timeout(5000)
                })

                actualOnline = response.ok
              }
            } catch (edgeError) {
              console.debug('Supabase ping fallback failed:', edgeError)
            }
          }
        }
      }

      // Update lastOnline time
      if (actualOnline && !lastOnlineTime) {
        lastOnlineTime = new Date()
      } else if (!actualOnline && lastOnlineTime) {
        // Keep the last online time when going offline
      }

      setNetworkState({
        isOnline: actualOnline,
        isSlowConnection,
        lastOnline: lastOnlineTime,
        connectionType
      })

      reportNetworkStatus(actualOnline)
    }

    // Initial check
    updateNetworkState()

    // Listen for network changes
    const handleOnline = () => updateNetworkState()
    const handleOffline = () => {
      // Immediately mark as offline when navigator goes offline
      setNetworkState(prev => ({
        ...prev,
        isOnline: false
      }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Periodic connectivity checks (every 30 seconds)
    const interval = setInterval(updateNetworkState, 30000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
    }
  }, []) // Remove networkState dependency to avoid stale closure

  return networkState
}