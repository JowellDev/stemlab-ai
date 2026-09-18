import { isProduction } from '~/lib/env.server'
import { currentRequestContext, logger, runWithRequestContext } from '~/lib/logger.server'
import { recordRequest } from '~/lib/metrics.server'
import { securityHeaders } from '~/lib/security.server'

/**
 * Traversee commune a toutes les requetes : identifiant, journal, en-tetes.
 *
 * Un middleware racine plutot qu'un `entry.server` : il couvre aussi les
 * requetes de donnees et les routes de ressources, qui ne passent pas par le
 * rendu du document.
 */

/**
 * Nonce de la requete en cours.
 *
 * Il passe par le contexte asynchrone, et non par la `Request` : React Router
 * ne transmet pas au chargeur l'instance que le middleware a vue, si bien qu'une
 * table indexee par requete rendait toujours vide — et la politique bloquait
 * alors les scripts de l'application elle-meme.
 */
export function currentNonce(): string | undefined {
  return currentRequestContext()?.nonce || undefined
}

export async function observability(
  { request }: { request: Request },
  next: () => Promise<Response>,
): Promise<Response> {
  const started = Date.now()
  const url = new URL(request.url)
  const requestId = crypto.randomUUID()
  // Aucun nonce en developpement : la politique y accepte l'inline, que Vite
  // utilise abondamment, et un nonce present desactiverait cette tolerance.
  // Le rendre vide evite au passage un `nonce=""` cote serveur face a un
  // attribut absent cote client — une divergence d'hydratation gratuite.
  const nonce = isProduction ? crypto.randomUUID().replaceAll('-', '') : ''

  const response = await runWithRequestContext(
    { requestId, nonce, method: request.method, path: url.pathname },
    next,
  )

  const durationMs = Date.now() - started
  recordRequest(request.method, response.status, durationMs)

  // Les fichiers statiques ne passent pas par ici ; tout ce qu'on voit merite
  // une ligne, y compris les redirections.
  logger.info('requete', {
    method: request.method,
    path: url.pathname,
    status: response.status,
    durationMs,
  })

  const headers = new Headers(response.headers)
  headers.set('x-request-id', requestId)
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    headers.set(name, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
