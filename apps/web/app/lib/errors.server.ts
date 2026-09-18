import { StemlabError, isStemlabError } from '@stemlab/contracts'
import { logger } from '~/lib/logger.server'
import { reportError } from '~/lib/monitoring.server'

/**
 * Transforme une erreur en reponse HTTP.
 *
 * Une erreur typee garde son code et son message : c'est elle qui decide de ce que
 * voit l'utilisateur. Tout le reste devient une 500 au message neutre — un message
 * d'erreur interne renseigne surtout celui qui sonde l'application.
 */
export function toErrorResponse(error: unknown): Response {
  if (isStemlabError(error)) {
    const headers = new Headers({ 'content-type': 'application/json' })
    // Une 429 sans `Retry-After` oblige l'appelant a deviner : il reessaiera
    // aussitot, et se fera refuser a nouveau.
    const retryAfter = error.fields?.retryAfter?.[0]
    if (error.code === 'rate_limited' && retryAfter) headers.set('retry-after', retryAfter)

    return new Response(JSON.stringify(error.toJSON()), { status: error.status, headers })
  }

  if (error instanceof Response) return error

  logger.error('erreur non geree', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  reportError(error)
  return Response.json(
    { code: 'internal_error', message: 'Une erreur interne est survenue.' },
    { status: 500 },
  )
}

/** Enveloppe un gestionnaire pour que toute erreur typee ressorte en JSON. */
export async function withErrorResponse<T>(handler: () => Promise<T>): Promise<T | Response> {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof Response) throw error
    return toErrorResponse(error)
  }
}

export { StemlabError }
