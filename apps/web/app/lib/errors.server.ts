import { StemlabError, isStemlabError } from '@stemlab/contracts'

/**
 * Transforme une erreur en reponse HTTP.
 *
 * Une erreur typee garde son code et son message : c'est elle qui decide de ce que
 * voit l'utilisateur. Tout le reste devient une 500 au message neutre — un message
 * d'erreur interne renseigne surtout celui qui sonde l'application.
 */
export function toErrorResponse(error: unknown): Response {
  if (isStemlabError(error)) {
    return Response.json(error.toJSON(), { status: error.status })
  }

  if (error instanceof Response) return error

  console.error('erreur non geree', error)
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
