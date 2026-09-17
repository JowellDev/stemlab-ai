import type { MultitrackPlayer, TransportState } from '@stemlab/audio-engine'
import type { Waveform as WaveformData } from '@stemlab/contracts'
import { Pause, Play, SkipBack } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { cn } from '~/lib/cn'
import { Playhead } from './playhead'
import { TimeDisplay } from './time-display'
import { Waveform } from './waveform'

interface TransportBarProps {
  player: MultitrackPlayer | null
  state: TransportState
  duration: number
  waveform: WaveformData | null
  onTogglePlay: () => void
}

export function TransportBar({
  player,
  state,
  duration,
  waveform,
  onTogglePlay,
}: TransportBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const playing = state === 'playing'
  const ready = player !== null && duration > 0

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const element = trackRef.current
      if (!element || !player || duration <= 0) return
      const bounds = element.getBoundingClientRect()
      const ratio = (clientX - bounds.left) / bounds.width
      player.seek(Math.min(Math.max(ratio, 0), 1) * duration)
    },
    [player, duration],
  )

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-surface-2 bg-surface-1 p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={onTogglePlay}
          aria-label={playing ? 'Mettre en pause' : 'Lire'}
          className="rounded-full bg-accent p-3 text-surface-0 transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? (
            <Pause aria-hidden className="size-5" />
          ) : (
            <Play aria-hidden className="size-5" />
          )}
        </button>

        <button
          type="button"
          disabled={!ready}
          onClick={() => player?.seek(0)}
          aria-label="Revenir au debut"
          className="rounded-full p-3 text-neutral-400 transition-colors hover:bg-surface-3 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SkipBack aria-hidden className="size-5" />
        </button>

        <TimeDisplay player={player} duration={duration} />
      </div>

      {/* Barre de progression : un slider natif porte l'accessibilite clavier,
          le canvas au-dessus n'est que decoratif. */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={trackRef}
          className={cn(
            'relative h-12 overflow-hidden rounded-lg bg-surface-2',
            ready && 'cursor-pointer',
          )}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            seekFromPointer(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) seekFromPointer(event.clientX)
          }}
        >
          {waveform ? (
            <Waveform waveform={waveform} stemType="other" dimmed={false} className="block" />
          ) : null}
          <Playhead player={player} duration={duration} />
        </div>
      </div>
    </div>
  )
}
