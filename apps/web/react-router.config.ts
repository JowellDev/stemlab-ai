import type { Config } from '@react-router/dev/config'

export default {
  // SSR active : le BFF (loaders/actions) tourne cote serveur, l'app shell est
  // ensuite mise en cache par le service worker (phase 7).
  ssr: true,

  // On adopte des maintenant la semantique v7 -> v8 : le middleware sert a
  // l'authentification (phase 4) et le reste evite une migration de rupture.
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config
