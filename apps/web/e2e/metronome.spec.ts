import { type Page, expect, test } from '@playwright/test'
import { openReadyTrack } from './helpers/track'

/**
 * Metronome du lecteur.
 *
 * Ce qui se verifie de l'exterieur, c'est qu'il **sonne** — un bouton qui
 * change d'etat sans produire de clic passerait tous les tests d'interface. Les
 * clics sont des oscillateurs carres, ce qui les distingue sans ambiguite du
 * moteur de lecture.
 */

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

interface Click {
  readonly when: number
  readonly hz: number
}

async function watchClicks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const start = OscillatorNode.prototype.start
    const cible = globalThis as { __clicks?: { when: number; hz: number }[] }
    cible.__clicks = []
    OscillatorNode.prototype.start = function patched(this: OscillatorNode, when?: number) {
      if (this.type === 'square') {
        cible.__clicks?.push({ when: when ?? 0, hz: this.frequency.value })
      }
      return start.call(this, when)
    }
  })
}

async function clicks(page: Page): Promise<Click[]> {
  return page.evaluate(() => (globalThis as { __clicks?: Click[] }).__clicks ?? [])
}

const region = (page: Page) => page.getByRole('region', { name: 'Metronome' })

test('le controle est propose quand l analyse fournit des temps', async ({ page }) => {
  await watchClicks(page)
  await openReadyTrack(page)

  await expect(region(page)).toBeVisible()
  // Le reglage de volume n'a pas de sens tant que le metronome est eteint.
  await expect(page.getByRole('slider', { name: 'Volume du metronome' })).toBeDisabled()
})

test('active, il sonne pendant la lecture', async ({ page }) => {
  await watchClicks(page)
  await openReadyTrack(page)

  expect(await clicks(page)).toHaveLength(0)

  await region(page).getByRole('button', { name: 'Metronome' }).click()
  await expect(page.getByRole('slider', { name: 'Volume du metronome' })).toBeEnabled()
  await page.getByRole('button', { name: 'Lire' }).click()

  await expect.poll(async () => (await clicks(page)).length, { timeout: 15_000 }).toBeGreaterThan(2)
})

test('le premier temps de la mesure est accentue', async ({ page }) => {
  await watchClicks(page)
  await openReadyTrack(page)

  await region(page).getByRole('button', { name: 'Metronome' }).click()
  await page.getByRole('button', { name: 'Lire' }).click()

  // Une mesure a quatre temps : cinq clics suffisent a couvrir un temps fort.
  await expect.poll(async () => (await clicks(page)).length, { timeout: 20_000 }).toBeGreaterThan(4)

  const frequences = new Set((await clicks(page)).map((click) => click.hz))
  expect(frequences.size).toBe(2)
})

test('les clics suivent la pulsation detectee', async ({ page }) => {
  await watchClicks(page)
  await openReadyTrack(page)

  await region(page).getByRole('button', { name: 'Metronome' }).click()
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect.poll(async () => (await clicks(page)).length, { timeout: 20_000 }).toBeGreaterThan(4)

  const liste = await clicks(page)
  const intervalles = liste.slice(1).map((click, index) => click.when - liste[index]!.when)

  // Les temps viennent de l'analyse : ils sont reguliers a quelques
  // millisecondes pres, pas parfaitement egaux comme le serait une grille.
  const moyenne = intervalles.reduce((somme, valeur) => somme + valeur, 0) / intervalles.length
  expect(moyenne).toBeGreaterThan(0.2)
  expect(moyenne).toBeLessThan(2)

  for (const intervalle of intervalles) {
    expect(Math.abs(intervalle - moyenne)).toBeLessThan(0.15)
  }
})

test('eteint, il ne sonne pas', async ({ page }) => {
  await watchClicks(page)
  await openReadyTrack(page)

  await page.getByRole('button', { name: 'Lire' }).click()
  await page.waitForTimeout(4000)

  expect(await clicks(page)).toHaveLength(0)
})
