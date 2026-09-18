import type { StemSource } from '@stemlab/audio-engine'
import { Alert, AlertDescription } from '@stemlab/ui'
import { useMemo } from 'react'
import { usePlayPause, useMultitrackPlayer } from '~/hooks/use-multitrack-player'
import { PlayerControls, type PlayerStem } from './player-controls'
import { ShortcutLegend } from './shortcut-legend'
import { StatusBadge } from './status-badge'

interface MultitrackPlayerViewProps {
  title: string
  subtitle?: string
  stems: readonly PlayerStem[]
}

/**
 * Lecteur autonome : il detient sa propre instance.
 *
 * Utilise par la page de verification du moteur. La page d'un morceau, elle, passe
 * par `TrackWorkspace`, qui partage le lecteur avec la grille d'accords.
 */
export function MultitrackPlayerView({ title, subtitle, stems }: MultitrackPlayerViewProps) {
  const sources = useMemo<StemSource[]>(
    () => stems.map(({ type, url }) => ({ type, url })),
    [stems],
  )
  const { player, transport, duration, stems: mix, progress, error } = useMultitrackPlayer(sources)
  const togglePlay = usePlayPause(player, transport)

  return (
    <section className="flex flex-col gap-4" aria-label={`Lecteur multipiste — ${title}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
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

      <PlayerControls
        player={player}
        transport={transport}
        duration={duration}
        stems={stems}
        mix={mix}
        onTogglePlay={togglePlay}
      />

      <ShortcutLegend />
    </section>
  )
}

export type { PlayerStem }
