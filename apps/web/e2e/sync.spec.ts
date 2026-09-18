import { expect, test } from '@playwright/test'
import { readPosition } from './helpers/position'

/**
 * Synchronisation, vue depuis le navigateur.
 *
 * Depuis la phase 6, les pistes ne sont plus des `AudioBufferSourceNode` distincts
 * mais les canaux d'un **unique** noeud d'etirement temporel : la derive entre
 * pistes n'est plus une propriete a surveiller, elle est structurellement
 * impossible. `drift.spec.ts` la mesure ; ce fichier verifie ce qui reste
 * observable de l'exterieur — que le moteur attendu est bien celui qui tourne, et
 * que la position ne derive pas de l'horloge audio.
 */

interface SourceStart {
  when: number
  offset: number
}

declare global {
  interface Window {
    __starts: SourceStart[]
    __audioCtx: AudioContext | null
  }
}

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__starts = []
    window.__audioCtx = null

    const originalStart = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function patched(
      when?: number,
      offset?: number,
      duration?: number,
    ) {
      // Le tampon d'une frame sert au deverrouillage iOS : il ne fait pas partie
      // du mix et ne doit pas etre compte.
      if ((this.buffer?.length ?? 0) > 1) {
        window.__starts.push({ when: when ?? 0, offset: offset ?? 0 })
      }
      return originalStart.call(this, when as number, offset as number, duration as number)
    }

    const OriginalContext = window.AudioContext
    window.AudioContext = class extends OriginalContext {
      constructor(options?: AudioContextOptions) {
        super(options)
        window.__audioCtx = this
      }
    } as typeof AudioContext
  })

  await page.goto('/dev/player')
  await expect(page.getByRole('button', { name: 'Lire' })).toBeEnabled({ timeout: 30_000 })
  await page.evaluate(() => {
    window.__starts = []
  })
})

test('les pistes passent par le moteur d etirement, pas par des sources separees', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()
  await expect.poll(() => readPosition(page)).toBeGreaterThan(0.5)

  // Aucune source de tampon n'est creee : les quatre pistes sont les canaux d'un
  // unique noeud. C'est ce qui rend la derive impossible par construction.
  expect(await page.evaluate(() => window.__starts.length)).toBe(0)
})

test('la position est exacte apres un seek', async ({ page }) => {
  for (const target of [5, 10, 5, 0]) {
    await page.locator('body').press('Home')
    await expect.poll(() => readPosition(page)).toBe(0)

    for (let remaining = target; remaining > 0; remaining -= 5) {
      await page.locator('body').press('ArrowRight')
    }
    // Aucune accumulation d'erreur : la position vaut exactement la cible.
    await expect.poll(() => readPosition(page)).toBe(target)
  }
})

test('une serie de seeks en lecture n accumule aucune erreur', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  for (const _ of [1, 2, 3, 4, 5]) {
    await page.locator('body').press('ArrowRight')
    await page.locator('body').press('ArrowLeft')
  }

  await page.locator('body').press('Home')
  await expect.poll(() => readPosition(page)).toBe(0)
})

test('la position suit l horloge audio sans deriver', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  // On echantillonne jusqu'a ce que la lecture ait franchi deux secondes, plutot
  // que pendant une duree fixe : sous charge, la machine peut mettre plus
  // longtemps a demarrer l'audio, sans que la propriete testee change.
  const samples = await page.evaluate(async () => {
    const readDisplayed = () => {
      const text =
        document.querySelector('[data-testid="playback-position"]')?.textContent ?? '0:00.0'
      const [minutes = '0', seconds = '0'] = text.split(':')
      return Number(minutes) * 60 + Number(seconds)
    }

    const collected: Array<{ audio: number; displayed: number }> = []
    const deadline = Date.now() + 25_000

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const displayed = readDisplayed()
      // Les instants ou rien n'a encore ete joue ne disent rien sur la derive.
      if (displayed > 0) {
        collected.push({ audio: window.__audioCtx?.currentTime ?? 0, displayed })
      }
      if (displayed > 2.5) break
    }
    return collected
  })

  expect(samples.length).toBeGreaterThan(3)
  expect(samples.at(-1)?.displayed ?? 0).toBeGreaterThan(2)

  // L'ecart entre horloge audio et position affichee reste constant : c'est la
  // definition d'une absence de derive. La tolerance couvre l'arrondi au dixieme
  // de seconde de l'affichage et l'avance de planification du moteur.
  const deltas = samples.map((sample) => sample.audio - sample.displayed)
  const spread = Math.max(...deltas) - Math.min(...deltas)
  expect(spread).toBeLessThan(0.4)
})
