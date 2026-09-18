import type { MultitrackPlayer } from '@stemlab/audio-engine'
import type { Chord } from '@stemlab/contracts'
import { type BarWithChords, barIndexAt } from '@stemlab/music'
import { cn } from '@stemlab/ui'
import { useCallback, useEffect, useRef } from 'react'
import { usePositionFollower } from '~/hooks/use-position-follower'

interface ChordGridProps {
  player: MultitrackPlayer | null
  bars: readonly BarWithChords[]
  onSeek: (time: number) => void
}

/**
 * Grille d'accords, une case par mesure.
 *
 * C'est la vue d'un musicien qui joue : quatre mesures par ligne, l'accord au
 * centre, la mesure courante mise en avant. Le defilement ne suit que les
 * changements de mesure — a l'echelle d'une grille, suivre chaque frame ferait
 * vibrer la page sans rien apporter.
 */
export function ChordGrid({ player, bars, onSeek }: ChordGridProps) {
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([])
  const activeRef = useRef(-1)

  const findIndex = useCallback((position: number) => barIndexAt(bars, position), [bars])

  const onChange = useCallback((index: number) => {
    itemsRef.current[activeRef.current]?.removeAttribute('data-active')
    activeRef.current = index

    const element = itemsRef.current[index]
    if (!element) return
    element.setAttribute('data-active', 'true')
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  usePositionFollower(player, findIndex, onChange)

  useEffect(() => {
    activeRef.current = -1
  }, [bars])

  if (bars.length === 0) {
    return (
      <p className="bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
        Aucune grille de mesures pour ce morceau.
      </p>
    )
  }

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Grille d'accords, par mesure">
      {bars.map((bar, index) => (
        <li key={bar.number}>
          <button
            ref={(element) => {
              itemsRef.current[index] = element
            }}
            type="button"
            onClick={() => onSeek(bar.start)}
            aria-label={`Mesure ${bar.number}${describeBar(bar)}`}
            className={cn(
              'bg-card hover:bg-accent relative flex h-20 w-full flex-col items-center justify-center gap-1',
              'rounded-lg border transition-colors',
              'data-[active=true]:border-brand data-[active=true]:bg-brand/10',
            )}
          >
            <span className="text-muted-foreground absolute left-2 top-1.5 text-[10px] tabular-nums">
              {bar.number}
            </span>

            <span className="flex flex-wrap items-baseline justify-center gap-x-2">
              {bar.chords.length === 0 ? (
                <span className="text-muted-foreground text-sm">—</span>
              ) : (
                bar.chords.map((entry, position) => (
                  <span
                    key={`${entry.chord.start}-${position}`}
                    className={cn(
                      'font-medium',
                      // Un seul accord sur la mesure : on lui donne toute la place.
                      bar.chords.length === 1 ? 'text-xl' : 'text-base',
                      entry.chord.label === 'N' && 'text-muted-foreground',
                    )}
                  >
                    {entry.chord.label === 'N' ? '—' : entry.chord.label}
                  </span>
                ))
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function describeBar(bar: BarWithChords): string {
  const labels = bar.chords.map((entry) => entry.chord.label).filter((label) => label !== 'N')
  return labels.length === 0 ? '' : ` : ${labels.join(', ')}`
}

export type { Chord }
