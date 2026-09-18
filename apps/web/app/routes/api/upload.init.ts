import { StemlabError, UploadInitRequest } from '@stemlab/contracts'
import { toErrorResponse } from '~/lib/errors.server'
import { enforce, identify } from '~/lib/rate-limit.server'
import { requireUserForApi } from '~/lib/session.server'
import { initUpload } from '~/lib/tracks.server'
import type { Route } from './+types/upload.init'

/**
 * Prepare un envoi direct vers S3.
 *
 * L'application ne recoit jamais l'audio : elle signe une URL et le navigateur
 * depose le fichier lui-meme.
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    const user = await requireUserForApi(request)
    await enforce('upload', identify(request, user.id))

    const parsed = UploadInitRequest.safeParse(await request.json())

    if (!parsed.success) {
      throw new StemlabError(
        'bad_request',
        'Requete invalide.',
        fieldsFromIssues(parsed.error.issues),
      )
    }

    return Response.json(await initUpload(user, parsed.data))
  } catch (error) {
    return toErrorResponse(error)
  }
}

function fieldsFromIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const name = issue.path.map(String).join('.') || '_'
    ;(fields[name] ??= []).push(issue.message)
  }
  return fields
}
