import { MAX_RATE, MIN_RATE, type StemSource } from '@stemlab/audio-engine'
import type { AnalysisResult } from '@stemlab/contracts'
import { pitchClassIndex } from '@stemlab/music'
import { Alert, AlertDescription, Button, Slider } from '@stemlab/ui'
import { Gauge } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChordPanel } from '~/components/chords/chord-panel'
import { PlayerControls, type PlayerStem } from '~/components/player/player-controls'
import { ShortcutLegend } from '~/components/player/shortcut-legend'
import { StatusBadge } from '~/components/player/status-badge'
import { usePlayPause, useMultitrackPlayer } from '~/hooks/use-multitrack-player'

interface TrackWorkspaceProps {
  title: string
  subtitle?: string
  stems: readonly PlayerStem[]
  analysis: AnalysisResult | null
}

/**
 * Page de travail d'un morceau.
 *
 * Le lecteur est detenu ici et partage : la grille d'accords et les pistes lisent
 * la meme horloge, ce qui garantit qu'elles ne peuvent pas diverger.
 */
export function TrackWorkspace({ title, subtitle, stems, analysis }: TrackWorkspaceProps) {
  const sources = useMemo<StemSource[]>(
    () => stems.map(({ type, url }) => ({ type, url })),
    [stems],
  )
  const { player, transport, duration, stems: mix, progress, error } = useMultitrackPlayer(sources)
  const togglePlay = usePlayPause(player, transport)

  const [semitones, setSemitones] = useState(0)
  const [rate, setRate] = useState(1)

  const onRateChange = useCallback(
    (value: number) => {
      setRate(value)
      player?.setPlaybackRate(value)
    },
    [player],
  )

  // Un nouveau lecteur repart au tempo original : on lui reapplique le reglage.
  useEffect(() => {
    if (player && rate !== 1) player.setPlaybackRate(rate)
  }, [player, rate])

  const keyRoot = useMemo(() => (analysis ? (pitchClassIndex(analysis.key) ?? 0) : 0), [analysis])

  return (
    <section className="flex flex-col gap-5" aria-label={`Morceau — ${title}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        <StatusBadge
          state={transport}
          loaded={progress?.loaded ?? 0}
          total={progress?.total ?? 0}
        />
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Chargement impossible : {error.message}</AlertDescription>
        </Alert>
      ) : null}

      {analysis ? (
        <ChordPanel
          player={player}
          analysis={analysis}
          keyRoot={keyRoot}
          duration={duration || 1}
          semitones={semitones}
          onSemitonesChange={setSemitones}
          rate={rate}
        />
      ) : null}

      <PlayerControls
        player={player}
        transport={transport}
        duration={duration}
        stems={stems}
        mix={mix}
        onTogglePlay={togglePlay}
      />

      <SpeedControl rate={rate} onChange={onRateChange} />

      <ShortcutLegend />
    </section>
  )
}

function SpeedControl({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) {
  const percent = Math.round(rate * 100)

  return (
    <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
      <Gauge aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="text-muted-foreground shrink-0 text-sm">Tempo</span>
        <Slider
          thumbLabel={`Tempo : ${percent} %`}
          value={[rate]}
          min={MIN_RATE}
          max={MAX_RATE}
          step={0.05}
          onValueChange={([value]) => onChange(value ?? 1)}
          className="min-w-0 flex-1"
        />
      </div>

      <span className="w-12 shrink-0 text-right text-sm tabular-nums">{percent} %</span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={rate === 1}
        onClick={() => onChange(1)}
      >
        Original
      </Button>
    </div>
  )
}
