import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.test.{ts,tsx}'],
    // Playwright a sa propre execution : sans cette exclusion, vitest ramasserait
    // les specs e2e et echouerait sur leurs imports.
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
