import {
  MAX_RATE,
  MAX_SEMITONES,
  MIN_RATE,
  MIN_SEMITONES,
  type StemSource,
} from '@stemlab/audio-engine'
import type { AnalysisResult } from '@stemlab/contracts'
import { pitchClassIndex } from '@stemlab/music'
import { offlineUrl } from '@stemlab/offline'
import { Alert, AlertDescription, Button, Slider } from '@stemlab/ui'
import { Gauge, Info, Music2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChordPanel } from '~/components/chords/chord-panel'
import { PlayerControls, type PlayerStem } from '~/components/player/player-controls'
import { ShortcutLegend } from '~/components/player/shortcut-legend'
import { StatusBadge } from '~/components/player/status-badge'
import { OfflineToggle } from '~/components/offline-toggle'
import { useOfflineTrack } from '~/hooks/use-offline-track'
import { usePlayPause, useMultitrackPlayer } from '~/hooks/use-multitrack-player'
import { createLazyOfflineFetch } from '~/lib/offline.client'

interface TrackWorkspaceProps {
  trackId: string
  title: string
  subtitle?: string
  stems: readonly PlayerStem[]
  analysis: AnalysisResult | null
  /** Format de chaque piste, pour le stockage hors-ligne. */
  formats: Readonly<Record<string, string>>
}

/**
 * Page de travail d'un morceau.
 *
 * Le lecteur est detenu ici et partage : la grille d'accords et les pistes lisent
 * la meme horloge, ce qui garantit qu'elles ne peuvent pas diverger.
 */
export function TrackWorkspace({
  trackId,
  title,
  subtitle,
  stems,
  analysis,
  formats,
}: TrackWorkspaceProps) {
  const loadStems = useCallback(
    async () =>
      stems.map((stem) => ({
        type: stem.type,
        url: stem.url,
        format: formats[stem.type] ?? 'opus',
      })),
    [stems, formats],
  )
  const offline = useOfflineTrack({ trackId, title, loadStems })

  // Une fois le morceau stocke, on lit les octets locaux : les URL presignees
  // expirent, pas celles-ci — et c'est ce qui rend la lecture possible sans reseau.
  const stored = offline.state === 'stored'
  const sources = useMemo<StemSource[]>(
    () => stems.map(({ type, url }) => ({ type, url: stored ? offlineUrl(trackId, type) : url })),
    [stems, stored, trackId],
  )
  const offlineFetch = useMemo(() => (stored ? createLazyOfflineFetch() : undefined), [stored])

  const {
    player,
    transport,
    duration,
    stems: mix,
    progress,
    error,
    supportsIndependentPitch,
  } = useMultitrackPlayer(sources, offlineFetch)
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

  const onSemitonesChange = useCallback(
    (value: number) => {
      setSemitones(value)
      player?.setSemitones(value)
    },
    [player],
  )

  // Un nouveau lecteur repart aux valeurs par defaut : on lui reapplique les
  // reglages en cours.
  useEffect(() => {
    if (!player) return
    if (rate !== 1) player.setPlaybackRate(rate)
    if (semitones !== 0) player.setSemitones(semitones)
  }, [player, rate, semitones])

  const keyRoot = useMemo(() => (analysis ? (pitchClassIndex(analysis.key) ?? 0) : 0), [analysis])

  return (
    <section className="flex flex-col gap-5" aria-label={`Morceau — ${title}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        <OfflineToggle offline={offline} title={title} />
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

      {offline.error ? (
        <Alert variant="destructive">
          <AlertDescription>{offline.error}</AlertDescription>
        </Alert>
      ) : null}

      {analysis ? (
        <ChordPanel
          player={player}
          analysis={analysis}
          keyRoot={keyRoot}
          duration={duration || 1}
          semitones={semitones}
          onSemitonesChange={onSemitonesChange}
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

      {!supportsIndependentPitch && transport !== 'idle' && transport !== 'loading' ? (
        <Alert>
          <Info />
          <AlertDescription>
            Le traitement audio avance n&apos;a pas pu etre charge sur ce navigateur. La lecture
            fonctionne, mais changer le tempo modifie aussi la hauteur, et la transposition
            n&apos;agit que sur les accords affiches.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <SpeedControl rate={rate} onChange={onRateChange} />
        <PitchControl
          semitones={semitones}
          onChange={onSemitonesChange}
          disabled={!supportsIndependentPitch}
        />
      </div>

      <ShortcutLegend />
    </section>
  )
}

function PitchControl({
  semitones,
  onChange,
  disabled,
}: {
  semitones: number
  onChange: (semitones: number) => void
  disabled: boolean
}) {
  const label = semitones > 0 ? `+${semitones}` : String(semitones)

  return (
    <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
      <Music2 aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="text-muted-foreground shrink-0 text-sm">Hauteur</span>
        <Slider
          thumbLabel={`Hauteur : ${label} demi-tons`}
          value={[semitones]}
          min={MIN_SEMITONES}
          max={MAX_SEMITONES}
          step={1}
          disabled={disabled}
          onValueChange={([value]) => onChange(value ?? 0)}
          className="min-w-0 flex-1"
        />
      </div>

      <span className="w-12 shrink-0 text-right text-sm tabular-nums">{label}</span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={semitones === 0}
        onClick={() => onChange(0)}
      >
        Original
      </Button>
    </div>
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
