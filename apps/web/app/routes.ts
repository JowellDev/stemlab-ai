import { type RouteConfig, index, prefix, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('health', 'routes/health.ts'),
  route('metrics', 'routes/metrics.ts'),
  route('legal', 'routes/legal.tsx'),
  route('dev/player', 'routes/dev.player.tsx'),
  route('dev/drift', 'routes/dev.drift.tsx'),

  // Authentification. Les URL restent a la racine : ce sont des pages, pas une
  // section de l'application.
  route('login', 'routes/auth/login.tsx'),
  route('signup', 'routes/auth/signup.tsx'),
  route('logout', 'routes/auth/logout.ts'),

  // Pages accessibles une fois connecte.
  route('library', 'routes/dashboard/library.tsx'),
  route('pad', 'routes/dashboard/pad.tsx'),
  route('tracks/:trackId', 'routes/dashboard/track.$trackId.tsx'),

  // Surface d'API : regroupee sous routes/api/ pour que la separation entre les
  // pages et ce qui est consomme par du code reste lisible d'un coup d'oeil.
  ...prefix('api', [
    // better-auth gere son propre routage interne a partir du chemin.
    route('auth/*', 'routes/api/auth.$.ts'),

    route('upload/init', 'routes/api/upload.init.ts'),
    route('upload/complete', 'routes/api/upload.complete.ts'),
    route('tracks/events', 'routes/api/tracks.events.ts'),
    route('tracks/:trackId/stems', 'routes/api/tracks.$trackId.stems.ts'),
    route('tracks/:trackId/delete', 'routes/api/tracks.$trackId.delete.ts'),

    // Webhook du service ML : signe HMAC, jamais appele par le navigateur.
    route('internal/jobs/callback', 'routes/api/internal.jobs.callback.ts'),
  ]),
] satisfies RouteConfig
