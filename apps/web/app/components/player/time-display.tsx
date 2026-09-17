import { type MultitrackPlayer, observePosition } from '@stemlab/audio-engine'
import { useEffect, useRef } from 'react'
import { formatTime, formatTimePrecise } from '~/lib/format'

interface TimeDisplayProps {
  player: MultitrackPlayer | null
  duration: number
}

/** Position courante / duree. Le texte est ecrit directement dans le noeud, pour la
 *  meme raison que le curseur : eviter un rendu React par frame. */
export function TimeDisplay({ player, duration }: TimeDisplayProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !player) return
    return observePosition(player, (position) => {
      const next = formatTimePrecise(position)
      if (element.textContent !== next) element.textContent = next
    })
  }, [player])

  return (
    <p className="font-mono text-sm tabular-nums text-neutral-400">
      {/* aria-live retire volontairement : annoncer chaque dixieme de seconde
          rendrait le lecteur inutilisable au lecteur d'ecran. */}
      <span ref={ref}>0:00.0</span>
      <span className="text-neutral-600"> / {formatTime(duration)}</span>
    </p>
  )
}
