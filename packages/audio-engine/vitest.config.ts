import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Les suites arrivent en phase 1 avec le MultitrackPlayer.
    passWithNoTests: true,
  },
})
