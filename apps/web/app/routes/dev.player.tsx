import { Waveform as WaveformSchema, StemType } from '@stemlab/contracts'
import { z } from 'zod'
import { MultitrackPlayerView, type PlayerStem } from '~/components/player/multitrack-player-view'
import type { Route } from './+types/dev.player'

/**
 * Page de verification du moteur audio (phase 1).
 *
 * Les quatre stems sont synthetises et versionnes dans le depot : ils partagent la
 * meme grille rythmique, donc la moindre desynchronisation s'entend immediatement
 * sur le kick et la basse, qui doivent tomber exactement ensemble.
 */

const Manifest = z.object({
  title: z.string(),
  artist: z.string(),
  durationSeconds: z.number(),
  bpm: z.number(),
  key: z.string(),
  mode: z.string(),
  stems: z.array(
    z.object({
      type: StemType,
      file: z.string(),
      waveform: WaveformSchema,
    }),
  ),
})

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Lecteur multipiste — STEMLAB' }, { name: 'robots', content: 'noindex' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const base = new URL('/dev-stems/', request.url)
  const response = await fetch(new URL('manifest.json', base))
  if (!response.ok) {
    throw new Response('Stems de demonstration introuvables', { status: 404 })
  }

  const manifest = Manifest.parse(await response.json())

  return {
    title: manifest.title,
    subtitle: `${manifest.artist} · ${manifest.key} ${manifest.mode === 'minor' ? 'mineur' : 'majeur'} · ${manifest.bpm} BPM`,
    stems: manifest.stems.map((stem) => ({
      type: stem.type,
      url: new URL(stem.file, base).pathname,
      waveform: stem.waveform,
    })) satisfies PlayerStem[],
  }
}

export default function DevPlayer({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-brand">
        STEMLAB · verification du moteur
      </p>
      <MultitrackPlayerView
        title={loaderData.title}
        subtitle={loaderData.subtitle}
        stems={loaderData.stems}
      />
    </main>
  )
}
