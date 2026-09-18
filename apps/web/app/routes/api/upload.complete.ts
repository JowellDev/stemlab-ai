import { StemlabError, UploadCompleteRequest } from '@stemlab/contracts'
import { toErrorResponse } from '~/lib/errors.server'
import { requireUserForApi } from '~/lib/session.server'
import { completeUpload } from '~/lib/tracks.server'
import type { Route } from './+types/upload.complete'

/** Confirme le depot et met le morceau en file de traitement. */
export async function action({ request }: Route.ActionArgs) {
  try {
    const user = await requireUserForApi(request)
    const parsed = UploadCompleteRequest.safeParse(await request.json())

    if (!parsed.success) {
      throw new StemlabError('bad_request', 'Identifiant de morceau invalide.')
    }

    await completeUpload(user, parsed.data.trackId)
    return Response.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
