import type { MultitrackPlayer } from '@stemlab/audio-engine'
import type { AnalysisResult } from '@stemlab/contracts'
import {
  MAX_SEMITONES,
  MIN_SEMITONES,
  accidentalForKey,
  assignChordsToBars,
  buildBars,
  clampSemitones,
  transposeChords,
} from '@stemlab/music'
import { Button, Separator, cn } from '@stemlab/ui'
import { Grid3x3, Minus, Plus, Rows3 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { ChordGrid } from './chord-grid'
import { ChordTimeline } from './chord-timeline'
import { TrackHeader } from './track-header'

type ChordView = 'grid' | 'timeline'

interface ChordPanelProps {
  player: MultitrackPlayer | null
  analysis: AnalysisResult
  keyRoot: number
  duration: number
  semitones: number
  onSemitonesChange: (value: number) => void
  rate: number
}

/**
 * Accords, tonalite et tempo.
 *
 * Les libelles sont transposes a l'affichage : rien n'est recalcule a partir de
 * l'audio, la fondamentale de chaque accord etant deja connue. L'orthographe suit
 * l'armure de la tonalite obtenue — lire `Bbm` plutot que `A#m` en fa mineur.
 */
export function ChordPanel({
  player,
  analysis,
  keyRoot,
  duration,
  semitones,
  onSemitonesChange,
  rate,
}: ChordPanelProps) {
  const [view, setView] = useState<ChordView>('grid')

  const mode = analysis.mode === 'minor' ? 'minor' : 'major'

  const chords = useMemo(() => {
    const accidental = accidentalForKey(keyRoot + semitones, mode)
    return transposeChords(analysis.chords, semitones, accidental)
  }, [analysis.chords, keyRoot, semitones, mode])

  const bars = useMemo(
    () => assignChordsToBars(buildBars(analysis.beats, analysis.timeSignature, duration), chords),
    [analysis.beats, analysis.timeSignature, duration, chords],
  )

  const onSeek = useCallback(
    (time: number) => {
      player?.seek(time)
    },
    [player],
  )

  const shift = useCallback(
    (delta: number) => onSemitonesChange(clampSemitones(semitones + delta)),
    [semitones, onSemitonesChange],
  )

  return (
    <section className="flex flex-col gap-3" aria-label="Accords et analyse">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TrackHeader analysis={analysis} semitones={semitones} rate={rate} keyRoot={keyRoot} />

        <div className="flex items-center gap-2">
          <TransposeControl
            semitones={semitones}
            onShift={shift}
            onReset={() => onSemitonesChange(0)}
          />
          <Separator orientation="vertical" className="h-6" />
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === 'grid' ? (
        <ChordGrid player={player} bars={bars} onSeek={onSeek} />
      ) : (
        <ChordTimeline player={player} chords={chords} duration={duration} onSeek={onSeek} />
      )}
    </section>
  )
}

function TransposeControl({
  semitones,
  onShift,
  onReset,
}: {
  semitones: number
  onShift: (delta: number) => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Transposition">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Transposer un demi-ton plus bas"
        disabled={semitones <= MIN_SEMITONES}
        onClick={() => onShift(-1)}
      >
        <Minus aria-hidden />
      </Button>

      <button
        type="button"
        onClick={onReset}
        disabled={semitones === 0}
        // Le libelle annonce la valeur et l'action : un simple « 0 » ne dirait pas
        // qu'il est cliquable pour revenir a la tonalite d'origine.
        aria-label={
          semitones === 0
            ? 'Aucune transposition'
            : `Transposition de ${semitones > 0 ? '+' : ''}${semitones} demi-tons — revenir a l'original`
        }
        className={cn(
          'min-w-12 rounded-md px-2 py-1 text-center text-sm tabular-nums transition-colors',
          semitones === 0 ? 'text-muted-foreground' : 'text-brand hover:bg-accent font-medium',
        )}
      >
        {semitones > 0 ? `+${semitones}` : semitones}
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Transposer un demi-ton plus haut"
        disabled={semitones >= MAX_SEMITONES}
        onClick={() => onShift(1)}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: ChordView; onChange: (view: ChordView) => void }) {
  return (
    <div className="bg-muted flex rounded-lg p-0.5" role="group" aria-label="Affichage des accords">
      {(
        [
          ['grid', 'Grille', Grid3x3],
          ['timeline', 'Ligne de temps', Rows3],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          // Le libelle visible dispparait sous 640 px : sans `aria-label`, le
          // bouton n'aurait plus aucun nom accessible sur mobile.
          aria-label={label}
          onClick={() => onChange(value)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
            view === value
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}
