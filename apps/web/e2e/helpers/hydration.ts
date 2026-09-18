import type { Page } from '@playwright/test'

/**
 * Attend que React ait attache ses gestionnaires d'evenements.
 *
 * Playwright rejoue un clic emis trop tot, mais pas un `change` : remplir un
 * champ fichier avant l'hydratation perd l'evenement definitivement. D'ou ce
 * point d'attente explicite avant toute interaction non rejouable.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true')
}
