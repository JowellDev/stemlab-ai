import { AnalysisResult, Waveform as WaveformSchema } from '@stemlab/contracts'
import { ArrowLeft } from 'lucide-react'
import { Link, redirect } from 'react-router'
import { AppShell } from '~/components/app-shell'
import type { PlayerStem } from '~/components/player/player-controls'
import { TrackWorkspace } from '~/components/track-workspace'
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
      stems: {
        select: { type: true, key: true, format: true, waveform: true },
        orderBy: { type: 'asc' },
      },
      analysis: true,
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

  // L'analyse est revalidee par le meme schema que celui du pipeline : ce qui est
  // en base a pu y entrer avant une evolution du format.
  const parsed = track.analysis
    ? AnalysisResult.safeParse({
        key: track.analysis.key,
        mode: track.analysis.mode,
        keyConfidence: track.analysis.keyConfidence,
        bpm: track.analysis.bpm,
        firstBeatOffset: track.analysis.firstBeatOffset,
        timeSignature: track.analysis.timeSignature,
        beats: track.analysis.beats,
        chords: track.analysis.chords,
      })
    : null

  if (parsed && !parsed.success) {
    console.warn('analyse illisible', { trackId: track.id, issues: parsed.error.issues })
  }

  return {
    user,
    // Le format de chaque piste sert au stockage hors-ligne : c'est lui qui
    // determine le nom du fichier et son type MIME a la relecture.
    formats: Object.fromEntries(track.stems.map((stem) => [stem.type, stem.format])),
    track: {
      id: track.id,
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
    },
    analysis: parsed?.success ? parsed.data : null,
    stems,
    urlsExpireAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  }
}

export default function Track({ loaderData }: Route.ComponentProps) {
  const { user, track, stems, analysis, formats } = loaderData
  const subtitle = track.artist ?? undefined

  return (
    <AppShell user={user}>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <Link
          to="/library"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Ma bibliotheque
        </Link>

        <TrackWorkspace
          trackId={track.id}
          title={track.title}
          {...(subtitle ? { subtitle } : {})}
          stems={stems}
          analysis={analysis}
          formats={formats}
        />
      </main>
    </AppShell>
  )
}
