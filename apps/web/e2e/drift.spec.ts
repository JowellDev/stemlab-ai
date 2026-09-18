import { type Page, expect, test } from '@playwright/test'

/**
 * Definition of Done de la phase 6 : aucune derive entre pistes apres cinq minutes
 * de lecture a 75 % de tempo et -3 demi-tons.
 *
 * La mesure passe par un rendu hors-ligne du **vrai** moteur de l'application :
 * cinq minutes d'audio sont rendues en quelques dizaines de secondes, et le chemin
 * verifie est celui reellement emprunte en production.
 */

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

// En serie : deux rendus longs simultanes epuiseraient la memoire disponible.
// Le format d'affichage, lui, est filtre par la configuration : la mesure porte
// sur le moteur audio et n'apprendrait rien de plus sur un second format.
test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/drift')
  await expect(page.getByTestId('drift-status')).toHaveText('pret')
})

test('le moteur dissocie tempo et hauteur', async ({ page }) => {
  const measurement = await measure(page, { seconds: 5, rate: 1, semitones: 0 })
  expect(measurement.independentPitch).toBe(true)
})

test('aucune derive entre pistes sur un extrait court', async ({ page }) => {
  const measurement = await measure(page, { seconds: 30, rate: 0.75, semitones: -3 })

  expect(measurement.eventsMeasured).toBeGreaterThan(5)
  expect(measurement.maxSpreadSamples).toBe(0)
})

test('aucune derive entre pistes apres cinq minutes a 75 % et -3 demi-tons', async ({ page }) => {
  test.setTimeout(300_000)

  const measurement = await measure(page, { seconds: 300, rate: 0.75, semitones: -3 })

  // Cinq minutes d'entree a 75 % donnent environ 400 s de sortie.
  expect(measurement.renderedSeconds).toBeGreaterThan(390)
  expect(measurement.eventsMeasured).toBeGreaterThan(20)

  // Zero echantillon d'ecart : les pistes partagent un unique noeud d'etirement,
  // la derive n'est pas seulement improbable, elle est structurellement impossible.
  expect(measurement.maxSpreadSamples).toBe(0)
})

test('aucune derive aux bornes des reglages', async ({ page }) => {
  test.setTimeout(180_000)

  for (const settings of [
    { seconds: 20, rate: 0.5, semitones: 12 },
    { seconds: 20, rate: 1.5, semitones: -12 },
  ]) {
    const measurement = await measure(page, settings)
    expect(measurement.maxSpreadSamples, JSON.stringify(settings)).toBe(0)
  }
})

async function measure(page: Page, options: { seconds: number; rate: number; semitones: number }) {
  return page.evaluate(
    (input) => window.__measureDrift?.(input) ?? Promise.reject(new Error('banc indisponible')),
    options,
  )
}
