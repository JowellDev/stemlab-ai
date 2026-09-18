import type { MultitrackPlayer, StemMixState, TransportState } from '@stemlab/audio-engine'
import type { StemType, Waveform as WaveformData } from '@stemlab/contracts'
import { useCallback, useState } from 'react'
import { usePlayerShortcuts } from '~/hooks/use-player-shortcuts'
import { StemTrack } from './stem-track'
import { TransportBar } from './transport-bar'

export interface PlayerStem {
  type: StemType
  url: string
  waveform: WaveformData
}

interface PlayerControlsProps {
  player: MultitrackPlayer | null
  transport: TransportState
  duration: number
  stems: readonly PlayerStem[]
  mix: readonly StemMixState[]
  onTogglePlay: () => void
}

/**
 * Transport et pistes.
 *
 * Purement presentationnel : le lecteur lui-meme est detenu plus haut, pour que la
 * grille d'accords et les pistes partagent la meme instance et donc la meme horloge.
 */
export function PlayerControls({
  player,
  transport,
  duration,
  stems,
  mix,
  onTogglePlay,
}: PlayerControlsProps) {
  const stemTypes = stems.map((stem) => stem.type)
  const [activeStem, setActiveStem] = useState<StemType | null>(stemTypes[0] ?? null)
  const onActivate = useCallback((type: StemType) => setActiveStem(type), [])

  usePlayerShortcuts({
    player,
    stems: stemTypes,
    activeStem,
    onActiveStemChange: onActivate,
    onTogglePlay,
  })

  const someoneSoloed = mix.some((stem) => stem.soloed)

  // A defaut d'un mix pre-calcule, « autres » donne la meilleure lecture
  // d'ensemble sur la barre de transport.
  const overview =
    stems.find((stem) => stem.type === 'other')?.waveform ?? stems[0]?.waveform ?? null

  return (
    <div className="flex flex-col gap-4">
      <TransportBar
        player={player}
        state={transport}
        duration={duration}
        waveform={overview}
        onTogglePlay={onTogglePlay}
      />

      <ul className="flex flex-col gap-2">
        {stems.map((stem) => {
          const stemMix = mix.find((candidate) => candidate.type === stem.type) ?? {
            type: stem.type,
            volume: 1,
            muted: false,
            soloed: false,
          }
          return (
            <StemTrack
              key={stem.type}
              player={player}
              mix={stemMix}
              waveform={stem.waveform}
              someoneSoloed={someoneSoloed}
              active={activeStem === stem.type}
              onActivate={onActivate}
            />
          )
        })}
      </ul>
    </div>
  )
}
