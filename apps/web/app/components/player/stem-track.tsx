import type { MultitrackPlayer, StemMixState } from '@stemlab/audio-engine'
import type { StemType, Waveform as WaveformData } from '@stemlab/contracts'
import { Headphones, Volume2, VolumeX } from 'lucide-react'
import { cn } from '~/lib/cn'
import { STEM_LABELS, STEM_TEXT_CLASS } from '~/lib/stems'
import { Waveform } from './waveform'

interface StemTrackProps {
  player: MultitrackPlayer | null
  mix: StemMixState
  waveform: WaveformData
  /** Vrai quand au moins une piste est en solo : les autres sont alors inaudibles. */
  someoneSoloed: boolean
  active: boolean
  onActivate: (type: StemType) => void
}

export function StemTrack({
  player,
  mix,
  waveform,
  someoneSoloed,
  active,
  onActivate,
}: StemTrackProps) {
  const silenced = mix.muted || (someoneSoloed && !mix.soloed)
  const label = STEM_LABELS[mix.type]

  return (
    <li
      className={cn(
        'grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border p-3 transition-colors',
        'sm:grid-cols-[9rem_auto_1fr]',
        active ? 'border-accent/50 bg-surface-2' : 'border-surface-2 bg-surface-1',
      )}
      onPointerDown={() => onActivate(mix.type)}
    >
      <h3
        className={cn(
          'col-span-2 text-sm font-medium sm:col-span-1',
          silenced ? 'text-neutral-500' : STEM_TEXT_CLASS[mix.type],
        )}
      >
        {label}
      </h3>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={mix.muted}
          aria-label={`${mix.muted ? 'Reactiver' : 'Couper'} la piste ${label}`}
          onClick={() => player?.toggleMute(mix.type)}
          className={cn(
            'rounded-md p-2 transition-colors',
            mix.muted
              ? 'bg-neutral-200 text-surface-0'
              : 'text-neutral-400 hover:bg-surface-3 hover:text-neutral-100',
          )}
        >
          {mix.muted ? (
            <VolumeX aria-hidden className="size-4" />
          ) : (
            <Volume2 aria-hidden className="size-4" />
          )}
        </button>

        <button
          type="button"
          aria-pressed={mix.soloed}
          aria-label={`${mix.soloed ? 'Retirer le solo de' : 'Mettre en solo'} la piste ${label}`}
          onClick={() => player?.toggleSolo(mix.type)}
          className={cn(
            'rounded-md p-2 transition-colors',
            mix.soloed
              ? 'bg-accent text-surface-0'
              : 'text-neutral-400 hover:bg-surface-3 hover:text-neutral-100',
          )}
        >
          <Headphones aria-hidden className="size-4" />
        </button>

        <label className="ml-1 flex items-center">
          <span className="sr-only">Volume de la piste {label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix.volume}
            onChange={(event) => player?.setVolume(mix.type, event.target.valueAsNumber)}
            className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent sm:w-24"
          />
        </label>
      </div>

      <div className="relative col-span-2 h-14 sm:col-span-1 sm:h-12">
        <Waveform waveform={waveform} stemType={mix.type} dimmed={silenced} className="block" />
      </div>
    </li>
  )
}
