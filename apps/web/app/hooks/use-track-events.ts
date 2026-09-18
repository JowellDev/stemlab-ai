import { TrackEvent } from '@stemlab/contracts'
import { useEffect, useState } from 'react'

/**
 * Suit l'etat des morceaux en direct.
 *
 * `EventSource` gere seul la reconnexion : il suffit de ne pas la contrarier. Les
 * evenements sont accumules dans une table indexee par morceau, que la page fusionne
 * avec les donnees rendues par le serveur.
 */
export function useTrackEvents(enabled: boolean): Map<string, TrackEvent> {
  const [events, setEvents] = useState<Map<string, TrackEvent>>(() => new Map())

  useEffect(() => {
    if (!enabled) return

    const source = new EventSource('/api/tracks/events')

    const onTrack = (message: MessageEvent<string>) => {
      const parsed = TrackEvent.safeParse(JSON.parse(message.data))
      if (!parsed.success) return
      setEvents((previous) => {
        const next = new Map(previous)
        next.set(parsed.data.trackId, parsed.data)
        return next
      })
    }

    source.addEventListener('track', onTrack)

    return () => {
      source.removeEventListener('track', onTrack)
      source.close()
    }
  }, [enabled])

  return events
}
