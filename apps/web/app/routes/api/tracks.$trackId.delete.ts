import { toErrorResponse } from '~/lib/errors.server'
import { enforce, identify } from '~/lib/rate-limit.server'
import { requireUserForApi } from '~/lib/session.server'
import { deleteTrack } from '~/lib/tracks.server'
import type { Route } from './+types/tracks.$trackId.delete'
import { parseTrackId } from '~/lib/params.server'

/** Supprime un morceau et ses objets S3. En `action` : jamais par simple visite. */
export async function action({ request, params }: Route.ActionArgs) {
  try {
    const user = await requireUserForApi(request)
    // La limite passe avant la validation : sinon, marteler des identifiants
    // malformes contournerait le compteur.
    await enforce('api', identify(request, user.id))
    const trackId = parseTrackId(params.trackId)
    await deleteTrack(user, trackId)
    return Response.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
