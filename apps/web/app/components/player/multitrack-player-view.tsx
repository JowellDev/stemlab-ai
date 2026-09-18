import type { StemSource } from '@stemlab/audio-engine'
import type { StemType, Waveform as WaveformData } from '@stemlab/contracts'
import { useCallback, useMemo, useState } from 'react'
import { usePlayPause, useMultitrackPlayer } from '~/hooks/use-multitrack-player'
import { usePlayerShortcuts } from '~/hooks/use-player-shortcuts'
import { StemTrack } from './stem-track'
import { TransportBar } from './transport-bar'

export interface PlayerStem {
  type: StemType
  url: string
  waveform: WaveformData
}

interface MultitrackPlayerViewProps {
  title: string
  subtitle?: string
  stems: readonly PlayerStem[]
}

export function MultitrackPlayerView({ title, subtitle, stems }: MultitrackPlayerViewProps) {
  const sources = useMemo<StemSource[]>(
    () => stems.map(({ type, url }) => ({ type, url })),
    [stems],
  )
  const { player, transport, duration, stems: mix, progress, error } = useMultitrackPlayer(sources)
  const togglePlay = usePlayPause(player, transport)

  const stemTypes = useMemo(() => stems.map((stem) => stem.type), [stems])
  const [activeStem, setActiveStem] = useState<StemType | null>(stemTypes[0] ?? null)
  const onActivate = useCallback((type: StemType) => setActiveStem(type), [])

  usePlayerShortcuts({
    player,
    stems: stemTypes,
    activeStem,
    onActiveStemChange: onActivate,
    onTogglePlay: togglePlay,
  })

  const someoneSoloed = mix.some((stem) => stem.soloed)
  const loading = transport === 'idle' || transport === 'loading'

  // La barre de transport montre la piste la plus dense a l'oeil : a defaut d'un mix
  // pre-calcule, « autres » donne la meilleure lecture d'ensemble.
  const overviewWaveform = useMemo(
    () => stems.find((stem) => stem.type === 'other')?.waveform ?? stems[0]?.waveform ?? null,
    [stems],
  )

  return (
    <section className="flex flex-col gap-4" aria-label={`Lecteur multipiste — ${title}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <StatusBadge
          state={transport}
          loaded={progress?.loaded ?? 0}
          total={progress?.total ?? 0}
        />
      </header>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm">
          Chargement impossible : {error.message}
        </p>
      ) : null}

      <TransportBar
        player={player}
        state={transport}
        duration={duration}
        waveform={overviewWaveform}
        onTogglePlay={togglePlay}
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

      <ShortcutLegend disabled={loading} />
    </section>
  )
}

function StatusBadge({ state, loaded, total }: { state: string; loaded: number; total: number }) {
  const text =
    state === 'loading'
      ? total > 0
        ? `Chargement ${loaded}/${total}`
        : 'Chargement'
      : state === 'idle'
        ? 'En attente'
        : state === 'playing'
          ? 'Lecture'
          : state === 'paused'
            ? 'En pause'
            : state === 'ended'
              ? 'Termine'
              : 'Pret'

  return (
    <p
      aria-live="polite"
      className="font-mono text-xs uppercase tracking-widest text-muted-foreground"
    >
      {text}
    </p>
  )
}

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Espace', 'Lecture / pause'],
  ['← →', 'Reculer / avancer de 5 s'],
  ['Maj + ← →', 'Pas de 1 s'],
  ['↑ ↓', 'Changer de piste'],
  ['M', 'Couper la piste active'],
  ['S', 'Solo sur la piste active'],
  ['Echap', 'Annuler tous les solos'],
]

function ShortcutLegend({ disabled }: { disabled: boolean }) {
  return (
    <details className="rounded-lg border border-border bg-card p-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Raccourcis clavier</summary>
      <dl className={`mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 ${disabled ? 'opacity-50' : ''}`}>
        {SHORTCUTS.map(([keys, description]) => (
          <div key={keys} className="flex items-baseline justify-between gap-3">
            <dt>
              <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-xs">
                {keys}
              </kbd>
            </dt>
            <dd className="text-muted-foreground">{description}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
