import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'

type RealtimeSocketState = 'connecting' | 'open' | 'closing' | 'closed'
type ConnectionPhase = 'idle' | RealtimeSocketState

interface RealtimeConnectionStatus {
  hasActiveRealtimeChannels: boolean
  isRealtimeConnected: boolean
  realtimeStatus: ConnectionPhase
  lastDisconnectedAt: number | null
  erroredChannelTopics: string[]
}

const DISCONNECTED_STATES: RealtimeSocketState[] = ['closing', 'closed']

export function useRealtimeConnectionStatus(pollIntervalMs = 4000): RealtimeConnectionStatus {
  const [realtimeStatus, setRealtimeStatus] = useState<ConnectionPhase>('idle')
  const [lastDisconnectedAt, setLastDisconnectedAt] = useState<number | null>(null)
  const [hasActiveRealtimeChannels, setHasActiveRealtimeChannels] = useState(false)
  const [erroredChannelTopics, setErroredChannelTopics] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let isMounted = true

    const evaluateConnection = () => {
      if (!isMounted) return

      const channels = supabase.getChannels()
      const hasChannels = channels.length > 0
      setHasActiveRealtimeChannels(hasChannels)
      const erroredTopics = channels
        .filter(channel => (channel as any).state === 'errored')
        .map(channel => channel.topic)
      setErroredChannelTopics(erroredTopics)

      if (!hasChannels) {
        setRealtimeStatus('idle')
        setLastDisconnectedAt(null)
        return
      }

      const currentState = supabase.realtime.connectionState() as RealtimeSocketState
      setRealtimeStatus(currentState)

      if (DISCONNECTED_STATES.includes(currentState)) {
        setLastDisconnectedAt(prev => prev ?? Date.now())
      } else if (currentState === 'open') {
        setLastDisconnectedAt(null)
      }
    }

    evaluateConnection()
    const intervalId = window.setInterval(evaluateConnection, pollIntervalMs)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [pollIntervalMs])

  return {
    hasActiveRealtimeChannels,
    isRealtimeConnected: realtimeStatus === 'open',
    realtimeStatus,
    lastDisconnectedAt,
    erroredChannelTopics,
  }
}
