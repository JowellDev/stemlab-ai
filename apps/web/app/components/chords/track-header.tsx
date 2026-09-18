import type { AnalysisResult } from '@stemlab/contracts'
import { transposeKey } from '@stemlab/music'

interface TrackHeaderProps {
  analysis: Pick<AnalysisResult, 'key' | 'mode' | 'bpm' | 'timeSignature' | 'keyConfidence'>
  /** Transposition appliquee, en demi-tons. */
  semitones: number
  /** Facteur de vitesse : 1 = tempo original. */
  rate: number
  keyRoot: number
}

/**
 * Tonalite, tempo et signature.
 *
 * Les valeurs affichees sont celles **entendues**, pas celles analysees : une
 * transposition de deux demi-tons change la tonalite affichee, un tempo a 75 %
 * change le BPM. Montrer l'analyse brute pendant qu'on entend autre chose serait
 * trompeur.
 */
export function TrackHeader({ analysis, semitones, rate, keyRoot }: TrackHeaderProps) {
  const key = transposeKey(keyRoot, analysis.mode === 'minor' ? 'minor' : 'major', semitones)
  const bpm = analysis.bpm * rate
  const transposed = semitones !== 0
  const retimed = Math.abs(rate - 1) > 0.001

  return (
    // Les separateurs sont dessines en bordure plutot qu'inseres comme
    // elements : une liste de definitions ne doit contenir que des paires,
    // et un `role="separator"` au milieu en casse la lecture par un lecteur
    // d'ecran.
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Metric label="Tonalite" value={key.label} altered={transposed} />
      <Metric label="Tempo" value={`${Math.round(bpm)} BPM`} altered={retimed} divided />
      <Metric
        label="Mesure"
        value={`${analysis.timeSignature.numerator}/${analysis.timeSignature.denominator}`}
        divided
      />
    </dl>
  )
}

function Metric({
  label,
  value,
  altered = false,
  divided = false,
}: {
  label: string
  value: string
  altered?: boolean
  /** Trait de separation a gauche, sur les formats larges. */
  divided?: boolean
}) {
  return (
    <div
      className={
        divided
          ? 'border-border flex items-baseline gap-1.5 sm:border-l sm:pl-4'
          : 'flex items-baseline gap-1.5'
      }
    >
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className={altered ? 'text-brand font-medium tabular-nums' : 'font-medium tabular-nums'}>
        {value}
        {altered ? <span className="sr-only"> (modifie)</span> : null}
      </dd>
    </div>
  )
}
