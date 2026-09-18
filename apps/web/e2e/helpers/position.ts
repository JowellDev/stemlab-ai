import type { Page } from '@playwright/test'

/**
 * Position de lecture affichee, en secondes.
 *
 * Lue depuis l'interface et non depuis le moteur : c'est ce que voit reellement
 * l'utilisateur, et donc ce qui doit rester aligne.
 */
export async function readPosition(page: Page): Promise<number> {
  return page.evaluate(() => {
    const text =
      document.querySelector('[data-testid="playback-position"]')?.textContent ?? '0:00.0'
    const [minutes = '0', seconds = '0'] = text.split(':')
    return Number(minutes) * 60 + Number(seconds)
  })
}
