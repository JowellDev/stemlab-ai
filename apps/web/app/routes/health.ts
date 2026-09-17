import type { Route } from './+types/health'

/**
 * Sonde de liveness utilisee par docker compose, Fly.io et la CI.
 * Volontairement sans acces base : elle repond tant que le process sert du HTTP.
 */
export function loader({ context: _context }: Route.LoaderArgs) {
  return Response.json(
    {
      status: 'ok',
      service: 'web',
      version: process.env.APP_VERSION ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
