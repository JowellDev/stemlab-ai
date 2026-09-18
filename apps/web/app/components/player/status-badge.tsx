import type { TransportState } from '@stemlab/audio-engine'

const LABELS: Record<TransportState, string> = {
  idle: 'En attente',
  loading: 'Chargement',
  ready: 'Pret',
  playing: 'Lecture',
  paused: 'En pause',
  ended: 'Termine',
}

interface StatusBadgeProps {
  state: TransportState
  loaded: number
  total: number
}

export function StatusBadge({ state, loaded, total }: StatusBadgeProps) {
  const text = state === 'loading' && total > 0 ? `Chargement ${loaded}/${total}` : LABELS[state]

  return (
    <p
      aria-live="polite"
      className="text-muted-foreground font-mono text-xs uppercase tracking-widest"
    >
      {text}
    </p>
  )
}
