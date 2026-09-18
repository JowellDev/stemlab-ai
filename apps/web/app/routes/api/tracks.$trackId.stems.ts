import { toErrorResponse } from '~/lib/errors.server'
import { db } from '~/lib/db.server'
import { presignDownload } from '~/lib/s3.server'
import { requireUserForApi } from '~/lib/session.server'
import type { Route } from './+types/tracks.$trackId.stems'

/**
 * URL des stems d'un morceau.
 *
 * Sert au telechargement hors-ligne depuis la bibliotheque, ou la page n'a pas
 * charge les URL presignees. Ce sont exactement les memes que pour la lecture :
 * rien de particulier cote serveur, les octets sont simplement conserves au lieu
 * d'etre jetes apres decodage.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    const user = await requireUserForApi(request)

    const track = await db.track.findFirst({
      // Le filtre par utilisateur est dans la requete : un morceau d'autrui doit
      // etre introuvable, pas seulement masque.
      where: { id: params.trackId, userId: user.id, status: 'ready' },
      select: {
        id: true,
        title: true,
        stems: { select: { type: true, key: true, format: true }, orderBy: { type: 'asc' } },
      },
    })

    if (!track) throw new Response('Morceau introuvable', { status: 404 })

    return Response.json({
      trackId: track.id,
      title: track.title,
      stems: await Promise.all(
        track.stems.map(async (stem) => ({
          type: stem.type,
          format: stem.format,
          url: await presignDownload(stem.key),
        })),
      ),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
