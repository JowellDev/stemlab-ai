import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`

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
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    // 390 px : le format de reference mobile impose par le cahier des charges.
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    env: {
      // Le webhook du worker est derive d'APP_URL : sans cela il pointerait vers
      // le port 3000 tandis que les tests tournent sur 3100.
      APP_URL: BASE_URL,
      BETTER_AUTH_URL: BASE_URL,
    },
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
