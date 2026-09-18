import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      // Le service worker est genere par Workbox, puis enregistre explicitement
      // par l'application : `autoUpdate` recharge sans demander, ce qui est
      // acceptable pour une application qui ne perd rien a se rafraichir.
      registerType: 'autoUpdate',
      injectRegister: null,
      strategies: 'generateSW',
      filename: 'sw.js',
      // React Router construit le client dans `build/client`, pas dans le `dist`
      // par defaut de Vite : sans cette indication, le service worker serait
      // genere a cote des fichiers servis, et jamais atteint.
      outDir: 'build/client',

      manifest: {
        name: 'STEMLAB — separation de pistes et analyse musicale',
        short_name: 'STEMLAB',
        description:
          'Separez vos morceaux en pistes isolees, detectez tonalite, tempo et accords, rejouez le tout dans un lecteur multipiste.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/library',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#14181f',
        theme_color: '#14181f',
        categories: ['music', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Le WASM de l'etirement temporel doit etre precache : sans lui, la
        // lecture hors-ligne perdrait tempo et hauteur independants.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // Un stem depasse largement la limite par defaut de 2 Mo.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // On garde la declaration pour la coherence de l'outillage, mais on
        // interdit a sa route de repondre : elle s'enregistre avant le cache
        // `pages` et Workbox retient la premiere route qui correspond, si bien
        // que toute navigation hors ligne retombait sur la page d'attente au
        // lieu du morceau telecharge. Le repli est recable plus bas, apres la
        // tentative reseau puis le cache.
        navigateFallback: '/offline.html',
        navigateFallbackDenylist: [/./],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,

        runtimeCaching: [
          {
            // Les pages ont besoin de donnees fraiches, mais une version en
            // cache vaut mieux qu'une erreur quand le reseau manque.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
              // Une page jamais visitee reste servie, faute de mieux.
              precacheFallback: { fallbackURL: '/offline.html' },
            },
          },
        ],
      },

      devOptions: {
        // Le service worker tourne aussi en developpement : sans cela, le mode
        // hors-ligne ne serait verifiable qu'apres un build complet.
        enabled: true,
        type: 'module',
        navigateFallback: '/offline.html',
      },
    }),
  ],

  // Vite 8 resout nativement les `paths` du tsconfig (~/* -> app/*).
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
})
