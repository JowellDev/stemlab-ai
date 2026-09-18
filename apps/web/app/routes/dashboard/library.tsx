import { Alert, AlertDescription } from '@stemlab/ui'
import type { TrackSummary } from '@stemlab/contracts'
import { Library as LibraryIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRevalidator } from 'react-router'
import { AppShell } from '~/components/app-shell'
import { TrackCard } from '~/components/track-card'
import { InstallBanner } from '~/components/install-banner'
import { UploadDropzone } from '~/components/upload-dropzone'
import { useTrackEvents } from '~/hooks/use-track-events'
import { db } from '~/lib/db.server'
import { requireUser } from '~/lib/session.server'
import type { Route } from './+types/library'
import { usageFor } from '~/lib/quota.server'
import { QuotaMeter } from '~/components/quota-meter'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Ma bibliotheque — STEMLAB' }, { name: 'robots', content: 'noindex' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)

  const tracks = await db.track.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      artist: true,
      durationSeconds: true,
      status: true,
      model: true,
      progress: true,
      stage: true,
      errorMessage: true,
      createdAt: true,
      analysis: { select: { key: true, mode: true, bpm: true } },
    },
  })

  return {
    user,
    quota: await usageFor(user.id, user.plan),
    tracks: tracks.map((track): TrackSummary => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
      status: track.status,
      model: track.model,
      progress: track.progress,
      stage: track.stage,
      errorMessage: track.errorMessage,
      createdAt: track.createdAt.toISOString(),
      key: track.analysis?.key ?? null,
      mode: track.analysis?.mode ?? null,
      bpm: track.analysis?.bpm ?? null,
    })),
  }
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { user, quota, tracks } = loaderData
  const revalidator = useRevalidator()
  const [deleting, setDeleting] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  // Le flux n'est ouvert que s'il y a quelque chose a suivre : inutile de tenir une
  // connexion pour une bibliotheque entierement traitee.
  const hasPending = tracks.some((track) => track.status !== 'ready' && track.status !== 'failed')
  const events = useTrackEvents(hasPending)

  const merged = useMemo(
    () =>
      tracks.map((track) => {
        const event = events.get(track.id)
        if (!event) return track
        return {
          ...track,
          status: event.status,
          progress: event.progress,
          stage: event.stage,
          errorMessage: event.errorMessage,
        }
      }),
    [tracks, events],
  )

  // Un morceau qui vient de passer a `ready` n'a pas encore sa tonalite ni son
  // tempo cote client : on redemande les donnees au serveur. Cet effet ne peut pas
  // vivre dans le corps du rendu — declencher une navigation pendant qu'un autre
  // composant se rend est precisement ce que React interdit.
  const justFinished = merged.some(
    (track) =>
      track.status === 'ready' &&
      tracks.find((original) => original.id === track.id)?.status !== 'ready',
  )

  useEffect(() => {
    if (justFinished && revalidator.state === 'idle') {
      void revalidator.revalidate()
    }
  }, [justFinished, revalidator])

  const onDelete = useCallback(
    async (trackId: string) => {
      const track = merged.find((candidate) => candidate.id === trackId)
      if (!track) return
      if (!globalThis.confirm(`Supprimer « ${track.title} » ? Cette action est definitive.`)) {
        return
      }

      setError(null)
      setDeleting((previous) => new Set(previous).add(trackId))

      try {
        const response = await fetch(`/api/tracks/${trackId}/delete`, { method: 'POST' })
        if (!response.ok) throw new Error('suppression refusee')
        await revalidator.revalidate()
      } catch {
        setError('La suppression a echoue. Reessayez.')
      } finally {
        setDeleting((previous) => {
          const next = new Set(previous)
          next.delete(trackId)
          return next
        })
      }
    },
    [merged, revalidator],
  )

  return (
    <AppShell user={user}>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Ma bibliotheque</h1>
          <p className="text-sm text-muted-foreground">
            {merged.length === 0
              ? 'Aucun morceau pour le moment.'
              : `${merged.length} morceau${merged.length > 1 ? 'x' : ''}.`}
          </p>
        </header>

        <InstallBanner />

        <QuotaMeter quota={quota} />

        <UploadDropzone onUploaded={() => void revalidator.revalidate()} />

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {merged.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-10 text-center">
            <LibraryIcon aria-hidden className="size-6 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              Deposez un premier morceau pour le decomposer en pistes.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {merged.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                deleting={deleting.has(track.id)}
                onDelete={(id) => void onDelete(id)}
              />
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  )
}
