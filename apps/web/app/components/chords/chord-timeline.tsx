import type { MultitrackPlayer } from '@stemlab/audio-engine'
import type { Chord } from '@stemlab/contracts'
import { chordIndexAt } from '@stemlab/music'
import { cn } from '@stemlab/ui'
import { useCallback, useEffect, useRef } from 'react'
import { usePositionFollower } from '~/hooks/use-position-follower'

interface ChordTimelineProps {
  player: MultitrackPlayer | null
  chords: readonly Chord[]
  duration: number
  onSeek: (time: number) => void
}

/** Largeur allouee a une seconde de morceau, en pixels. */
const PIXELS_PER_SECOND = 90

/**
 * Suite d'accords sur une ligne de temps.
 *
 * La largeur de chaque accord est proportionnelle a sa duree : on lit d'un coup
 * d'oeil qu'un accord tient quatre temps et le suivant deux. Le defilement suit la
 * lecture et se recentre a chaque changement d'accord, pas a chaque frame — un
 * recentrage continu donnerait un mouvement flottant, desagreable a suivre.
 */
export function ChordTimeline({ player, chords, duration, onSeek }: ChordTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([])
  const activeRef = useRef(-1)

  const findIndex = useCallback((position: number) => chordIndexAt(chords, position), [chords])

  const onChange = useCallback((index: number) => {
    const previous = itemsRef.current[activeRef.current]
    previous?.removeAttribute('data-active')

    activeRef.current = index
    const element = itemsRef.current[index]
    if (!element) return

    element.setAttribute('data-active', 'true')
    element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [])

  const onFrame = useCallback(
    (position: number) => {
      const cursor = cursorRef.current
      if (!cursor || duration <= 0) return
      cursor.style.transform = `translate3d(${(position * PIXELS_PER_SECOND).toFixed(1)}px, 0, 0)`
    },
    [duration],
  )

  usePositionFollower(player, findIndex, onChange, onFrame)

  // Le morceau a change : on repart du debut de la ligne.
  useEffect(() => {
    activeRef.current = -1
    scrollRef.current?.scrollTo({ left: 0 })
  }, [chords])

  if (chords.length === 0) {
    return <EmptyChords />
  }

  return (
    <div
      ref={scrollRef}
      className="bg-card relative overflow-x-auto rounded-xl border p-3"
      aria-label="Suite d'accords"
    >
      <div className="relative" style={{ width: `${duration * PIXELS_PER_SECOND}px` }}>
        <ol className="flex h-16 items-stretch gap-1">
          {chords.map((chord, index) => (
            <li
              key={`${chord.start}-${chord.label}`}
              style={{ width: `${(chord.end - chord.start) * PIXELS_PER_SECOND}px` }}
              className="shrink-0"
            >
              <button
                ref={(element) => {
                  itemsRef.current[index] = element
                }}
                type="button"
                onClick={() => onSeek(chord.start)}
                title={`${chord.label} — ${formatRange(chord)}`}
                className={cn(
                  'bg-muted hover:bg-accent flex h-full w-full items-center justify-center rounded-md',
                  'text-sm font-medium transition-colors',
                  'data-[active=true]:bg-brand data-[active=true]:text-brand-foreground',
                  chord.label === 'N' && 'text-muted-foreground',
                )}
              >
                {chord.label === 'N' ? '—' : chord.label}
              </button>
            </li>
          ))}
        </ol>

        <div
          ref={cursorRef}
          aria-hidden
          className="bg-brand pointer-events-none absolute inset-y-0 left-3 w-0.5"
        />
      </div>
    </div>
  )
}

function EmptyChords() {
  return (
    <p className="bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
      Aucun accord detecte pour ce morceau.
    </p>
  )
}

function formatRange(chord: Chord): string {
  return `${chord.start.toFixed(1)} s a ${chord.end.toFixed(1)} s`
}
