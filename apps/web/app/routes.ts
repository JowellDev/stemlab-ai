import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('health', 'routes/health.ts'),
  route('dev/player', 'routes/dev.player.tsx'),
] satisfies RouteConfig
