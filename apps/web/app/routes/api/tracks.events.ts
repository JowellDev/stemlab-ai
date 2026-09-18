import type { TrackEvent } from '@stemlab/contracts'
import { db } from '~/lib/db.server'
import { requireUserForApi } from '~/lib/session.server'
import type { Route } from './+types/tracks.events'

/**
 * Flux d'evenements de la bibliotheque (SSE).
 *
 * L'etat est relu en base plutot que pousse depuis un bus en memoire. Ce choix
 * merite d'etre explicite : le webhook du worker peut atterrir sur une instance et
 * le flux SSE vivre sur une autre — c'est le cas des le deploiement multi-region de
 * la phase 9. Un bus en memoire laisserait alors l'utilisateur devant une barre de
 * progression figee. Une requete indexee toutes les 1,5 s coute beaucoup moins cher
 * qu'un bus distribue, et reste correcte quelle que soit la topologie.
 *
 * Seuls les changements sont emis : un morceau dont rien n'a bouge ne genere aucun
 * octet.
 */

const POLL_INTERVAL_MS = 1500
/** Au-dela, le navigateur se reconnecte : cela evite les connexions fantomes. */
const MAX_STREAM_MS = 10 * 60 * 1000
const HEARTBEAT_MS = 25_000

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUserForApi(request)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const seen = new Map<string, string>()
      let closed = false
      let lastHeartbeat = Date.now()

      const send = (payload: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(timer)
        try {
          controller.close()
        } catch {
          // Le flux etait deja ferme par le client : rien a faire.
        }
      }

      request.signal.addEventListener('abort', close)
      send(': connecte\n\n')

      const startedAt = Date.now()

      const tick = async () => {
        if (closed) return
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          close()
          return
        }

        try {
          const tracks = await db.track.findMany({
            where: { userId: user.id },
            select: {
              id: true,
              status: true,
              progress: true,
              stage: true,
              errorMessage: true,
            },
          })

          for (const track of tracks) {
            const event: TrackEvent = {
              trackId: track.id,
              status: track.status,
              progress: track.progress,
              stage: track.stage,
              errorMessage: track.errorMessage,
            }
            const serialized = JSON.stringify(event)
            if (seen.get(track.id) === serialized) continue
            seen.set(track.id, serialized)
            send(`event: track\ndata: ${serialized}\n\n`)
            lastHeartbeat = Date.now()
          }

          if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
            send(': battement\n\n')
            lastHeartbeat = Date.now()
          }
        } catch (error) {
          console.error('flux de morceaux interrompu', error)
          close()
        }
      }

      const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
      await tick()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // Desactive la mise en tampon des proxys, qui retiendrait les evenements.
      'x-accel-buffering': 'no',
    },
  })
}
