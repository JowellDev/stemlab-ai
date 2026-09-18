import { Button, Progress, cn } from '@stemlab/ui'
import type { TrackSummary } from '@stemlab/contracts'
import { AlertTriangle, Clock, Loader2, Music4, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { formatTime } from '~/lib/format'

const STATUS_LABELS: Record<TrackSummary['status'], string> = {
  uploaded: 'En attente',
  queued: 'En file',
  processing: 'Traitement',
  ready: 'Pret',
  failed: 'Echec',
}

const STATUS_STYLES: Record<TrackSummary['status'], string> = {
  uploaded: 'text-muted-foreground',
  queued: 'text-muted-foreground',
  processing: 'text-brand',
  ready: 'text-emerald-400',
  failed: 'text-red-400',
}

interface TrackCardProps {
  track: TrackSummary
  onDelete: (trackId: string) => void
  deleting: boolean
}

export function TrackCard({ track, onDelete, deleting }: TrackCardProps) {
  const inProgress = track.status === 'queued' || track.status === 'processing'
  const ready = track.status === 'ready'

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-4',
        deleting && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">
            {ready ? (
              <Link
                to={`/tracks/${track.id}`}
                className="hover:text-brand hover:underline underline-offset-4"
              >
                {track.title}
              </Link>
            ) : (
              track.title
            )}
          </h3>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className={cn('flex items-center gap-1', STATUS_STYLES[track.status])}>
              {inProgress ? (
                <Loader2 aria-hidden className="size-3 animate-spin" />
              ) : track.status === 'failed' ? (
                <AlertTriangle aria-hidden className="size-3" />
              ) : ready ? (
                <Music4 aria-hidden className="size-3" />
              ) : (
                <Clock aria-hidden className="size-3" />
              )}
              {STATUS_LABELS[track.status]}
            </span>

            {track.durationSeconds ? <span>{formatTime(track.durationSeconds)}</span> : null}
            {track.key && track.mode ? (
              <span>
                {track.key} {track.mode === 'minor' ? 'mineur' : 'majeur'}
              </span>
            ) : null}
            {track.bpm ? <span>{Math.round(track.bpm)} BPM</span> : null}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Supprimer ${track.title}`}
          disabled={deleting}
          onClick={() => onDelete(track.id)}
          className="text-muted-foreground hover:text-red-400"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>

      {inProgress ? (
        <div>
          <Progress
            value={track.progress}
            aria-label={`Traitement de ${track.title} : ${track.progress} %`}
            className="h-1.5"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {track.progress} %{track.stage ? ` — ${track.stage}` : ''}
          </p>
        </div>
      ) : null}

      {track.status === 'failed' && track.errorMessage ? (
        <p className="rounded-md bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {track.errorMessage}
        </p>
      ) : null}
    </li>
  )
}
