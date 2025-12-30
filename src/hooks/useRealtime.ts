import { useEffect, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'

export function useRealtimeSubscription<T>(
  table: string,
  filter?: { column: string; value: any },
  callback?: (payload: any) => void
) {
  const [data, setData] = useState<T[]>([])
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)

  useEffect(() => {
    // Create channel
    const channelName = `realtime:${table}${filter ? `:${filter.column}:${filter.value}` : ''}`
    const newChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: table,
          filter: filter ? filter.column + '=eq.' + filter.value : undefined
        },
        (payload) => {
          console.log('Realtime update:', payload)
          if (callback) {
            callback(payload)
          }
        }
      )
      .subscribe()

    setChannel(newChannel)

    // Initial fetch
    const fetchData = async () => {
      let query = supabase.from(table).select('*')
      if (filter) {
        query = query.eq(filter.column, filter.value)
      }
      const { data, error } = await query
      if (!error && data) {
        setData(data as T[])
      }
    }

    fetchData()

    return () => {
      newChannel.unsubscribe()
    }
  }, [table, filter?.column, filter?.value, callback])

  return { data, channel }
}

