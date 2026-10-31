import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './api'

const REFRESHED = ['orders', 'order', 'floor', 'kitchen', 'alerts', 'quote']

/**
 * Listens for "something changed" signals on the branch's private channel and refetches.
 * Signals carry no data. If the connection drops, the regular refreshes still keep screens current.
 */
export function useLiveUpdates(branchIds: string[]) {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const key = branchIds.join(',')

  useEffect(() => {
    let cancelled = false
    let wait: ReturnType<typeof setTimeout> | undefined
    const channels: ReturnType<typeof supabase.channel>[] = []

    const refresh = () => {
      // A burst of changes only needs one refetch.
      clearTimeout(wait)
      wait = setTimeout(() => {
        for (const name of REFRESHED) queryClient.invalidateQueries({ queryKey: [name] })
      }, 250)
    }

    supabase.realtime.setAuth().then(() => {
      if (cancelled) return
      for (const id of key.split(',').filter(Boolean)) {
        const channel = supabase.channel(`branch:${id}`, { config: { private: true } })
        channel.on('broadcast', { event: 'changed' }, refresh).subscribe((status) => {
          if (!cancelled) setConnected(status === 'SUBSCRIBED')
        })
        channels.push(channel)
      }
    })

    return () => {
      cancelled = true
      clearTimeout(wait)
      for (const channel of channels) supabase.removeChannel(channel)
    }
  }, [key, queryClient])

  return connected
}
