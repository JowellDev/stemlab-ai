import { env, isProduction } from '~/lib/env.server'
import { renderMetrics } from '~/lib/metrics.server'
import type { Route } from './+types/metrics'

/**
 * Metriques Prometheus.
 *
 * Protegees par un jeton : elles decrivent le trafic et le nombre de comptes,
 * ce qui n'a pas a etre public. Sans jeton configure, la route n'existe qu'en
 * developpement — mieux vaut une metrique manquante qu'une fuite silencieuse.
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (!authorized(request)) throw new Response('Not Found', { status: 404 })

  return new Response(await renderMetrics(), {
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function authorized(request: Request): boolean {
  if (!env.METRICS_TOKEN) return !isProduction

  const header = request.headers.get('authorization') ?? ''
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token === env.METRICS_TOKEN
}
