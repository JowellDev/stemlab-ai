import { Waveform as WaveformSchema } from '@stemlab/contracts'
import { ArrowLeft } from 'lucide-react'
import { Link, redirect } from 'react-router'
import { AppShell } from '~/components/app-shell'
import { MultitrackPlayerView, type PlayerStem } from '~/components/player/multitrack-player-view'
import { db } from '~/lib/db.server'
import { DOWNLOAD_URL_TTL_SECONDS, presignDownload } from '~/lib/s3.server'
import { requireUser } from '~/lib/session.server'
import type { Route } from './+types/track.$trackId'

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data ? `${data.track.title} — STEMLAB` : 'Morceau — STEMLAB' },
    { name: 'robots', content: 'noindex' },
  ]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)

  const track = await db.track.findFirst({
    // Le filtre par utilisateur est dans la requete, pas apres : un morceau d'autrui
    // ne doit pas seulement etre masque, il doit etre introuvable.
    where: { id: params.trackId, userId: user.id },
    select: {
      id: true,
      title: true,
      artist: true,
      durationSeconds: true,
      status: true,
      stems: { select: { type: true, key: true, waveform: true }, orderBy: { type: 'asc' } },
      analysis: { select: { key: true, mode: true, bpm: true, keyConfidence: true } },
    },
  })

  if (!track) throw new Response('Morceau introuvable', { status: 404 })
  if (track.status !== 'ready') throw redirect('/library')

  // Les URLs sont signees a chaque chargement : elles expirent, et ne sont donc
  // jamais partageables durablement.
  const stems: PlayerStem[] = await Promise.all(
    track.stems.map(async (stem) => ({
      type: stem.type,
      url: await presignDownload(stem.key),
      waveform: WaveformSchema.parse(stem.waveform),
    })),
  )

  return {
    user,
    track: {
      id: track.id,
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
      analysis: track.analysis,
    },
    stems,
    urlsExpireAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  }
}

export default function Morceau({ loaderData }: Route.ComponentProps) {
  const { user, track, stems } = loaderData

  const subtitle = [
    track.artist,
    track.analysis
      ? `${track.analysis.key} ${track.analysis.mode === 'minor' ? 'mineur' : 'majeur'}`
      : null,
    track.analysis ? `${Math.round(track.analysis.bpm)} BPM` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <AppShell user={user}>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <Link
          to="/library"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Ma bibliotheque
        </Link>

        <MultitrackPlayerView
          title={track.title}
          {...(subtitle ? { subtitle } : {})}
          stems={stems}
        />
      </main>
    </AppShell>
  )
}
