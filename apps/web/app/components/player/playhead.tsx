import { cn } from '@stemlab/ui'
import { type MultitrackPlayer, observePosition } from '@stemlab/audio-engine'
import { useEffect, useRef } from 'react'

interface PlayheadProps {
  player: MultitrackPlayer | null
  duration: number
  className?: string
}

/**
 * Curseur de lecture.
 *
 * Positionne par ecriture directe dans le DOM a chaque frame, sans passer par
 * l'etat React : a 60 Hz, un `setState` par frame ferait re-rendre tout le lecteur
 * pour deplacer un trait d'un pixel. La valeur vient toujours de l'horloge audio,
 * et le deplacement passe par `transform` pour ne declencher que de la composition.
 */
export function Playhead({ player, duration, className }: PlayheadProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !player || duration <= 0) return
    const track = element.parentElement
    if (!track) return

    let width = track.clientWidth
    const observer = new ResizeObserver(() => {
      width = track.clientWidth
    })
    observer.observe(track)

    const stop = observePosition(player, (position) => {
      const x = (position / duration) * width
      element.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`
    })

    return () => {
      observer.disconnect()
      stop()
    }
  }, [player, duration])

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-brand shadow-[0_0_8px_var(--color-brand)]',
        className,
      )}
    />
  )
}
