import { Button, Slider, cn } from '@stemlab/ui'
import { Timer } from 'lucide-react'

interface MetronomeControlProps {
  enabled: boolean
  volume: number
  onEnabledChange: (value: boolean) => void
  onVolumeChange: (value: number) => void
}

/**
 * Metronome du lecteur.
 *
 * Il sonne sur les temps detectes dans l'enregistrement, pas sur une grille
 * calculee a partir du tempo : un morceau joue par des humains respire, et une
 * grille reguliere derive au bout de quelques mesures. Le premier temps de
 * chaque mesure est accentue.
 */
export function MetronomeControl({
  enabled,
  volume,
  onEnabledChange,
  onVolumeChange,
}: MetronomeControlProps) {
  return (
    <section
      className="bg-card flex items-center gap-3 rounded-lg border p-3"
      aria-label="Metronome"
    >
      <Button
        type="button"
        size="sm"
        variant={enabled ? 'secondary' : 'ghost'}
        aria-pressed={enabled}
        onClick={() => onEnabledChange(!enabled)}
        className="shrink-0"
      >
        <Timer aria-hidden className={cn('size-4', enabled && 'text-brand')} />
        Metronome
      </Button>

      <Slider
        value={[volume]}
        min={0}
        max={1}
        step={0.01}
        disabled={!enabled}
        thumbLabel="Volume du metronome"
        onValueChange={([next]) => onVolumeChange(next ?? volume)}
        className="min-w-0 flex-1"
      />

      <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
        {Math.round(volume * 100)} %
      </span>
    </section>
  )
}
