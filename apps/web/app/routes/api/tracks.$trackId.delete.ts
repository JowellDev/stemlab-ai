import { toErrorResponse } from '~/lib/errors.server'
import { requireUserForApi } from '~/lib/session.server'
import { deleteTrack } from '~/lib/tracks.server'
import type { Route } from './+types/tracks.$trackId.delete'

/** Supprime un morceau et ses objets S3. En `action` : jamais par simple visite. */
export async function action({ request, params }: Route.ActionArgs) {
  try {
    const user = await requireUserForApi(request)
    await deleteTrack(user, params.trackId)
    return Response.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
