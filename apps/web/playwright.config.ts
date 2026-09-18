import { defineConfig, devices } from '@playwright/test'

const DEV_PORT = 3100
const DEV_URL = `http://127.0.0.1:${DEV_PORT}`

/**
 * Le mode hors-ligne ne se teste que sur un build de production.
 *
 * En developpement, les modules JavaScript viennent du serveur Vite et ne sont pas
 * precaches : la page s'affiche depuis le cache mais React ne s'hydrate jamais.
 * Seul un build reel met les bundles entre les mains de Workbox.
 */
const PWA_PORT = 3200
const PWA_URL = `http://127.0.0.1:${PWA_PORT}`

/**
 * Limites de debit relevees pour les tests.
 *
 * Toute la suite part d'une seule adresse : la limite d'authentification de
 * production — dix par minute — bloquerait la dizaine de comptes que les tests
 * creent. `RATE_LIMIT_API` reste bas a dessein : il porte sur l'utilisateur, et
 * un test dedie doit pouvoir l'atteindre sans tirer des centaines de requetes.
 */
const RATE_LIMITS = {
  RATE_LIMIT_AUTH: '500',
  RATE_LIMIT_UPLOAD: '500',
  RATE_LIMIT_API: '30',
}

const SERVER_ENV = {
  APP_URL: DEV_URL,
  BETTER_AUTH_URL: DEV_URL,
  ...RATE_LIMITS,
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // En developpement, la premiere visite d'une route declenche sa compilation :
  // cinq secondes ne suffisent pas, et le test echouerait pour une raison qui
  // n'existe pas en production.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: DEV_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /offline\.spec\.ts/,
    },
    {
      // 390 px : le format de reference mobile impose par le cahier des charges.
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      // La mesure de derive porte sur le moteur audio, pas sur la mise en page :
      // la rejouer ici doublerait une empreinte memoire deja lourde — cinq minutes
      // de rendu hors-ligne sur huit canaux representent plus de 500 Mo.
      testIgnore: /(offline|drift)\.spec\.ts/,
    },
    {
      name: 'pwa',
      use: { ...devices['Desktop Chrome'], baseURL: PWA_URL },
      testMatch: /offline\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: `pnpm dev --port ${DEV_PORT}`,
      url: `${DEV_URL}/health`,
      env: {
        // Le webhook du worker est derive d'APP_URL : sans cela il pointerait vers
        // le port 3000 tandis que les tests tournent sur 3100.
        ...SERVER_ENV,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm build && PORT=${PWA_PORT} pnpm start`,
      url: `${PWA_URL}/health`,
      env: { APP_URL: PWA_URL, BETTER_AUTH_URL: PWA_URL, ...RATE_LIMITS },
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
})
