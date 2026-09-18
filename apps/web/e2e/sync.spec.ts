import { expect, test } from '@playwright/test'

/**
 * Preuve de synchronisation dans un vrai navigateur.
 *
 * `AudioBufferSourceNode.prototype.start` est instrumente avant tout script de la
 * page : chaque demarrage planifie par le lecteur est enregistre avec son instant
 * absolu et son offset. Les tests unitaires prouvent que le planificateur produit un
 * `when` unique ; ceux-ci prouvent que c'est bien ce qui arrive au moteur audio reel,
 * a travers le decodage Opus, React et l'AudioContext du navigateur.
 */

interface StartRecord {
  when: number
  offset: number
  at: number
}

declare global {
  interface Window {
    __starts: StartRecord[]
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
      // Le buffer d'une frame sert au deverrouillage iOS : il ne fait pas partie du mix.
      if ((this.buffer?.length ?? 0) > 1) {
        window.__starts.push({
          when: when ?? 0,
          offset: offset ?? 0,
          at: this.context.currentTime,
        })
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
  await expect(page.getByText('Pret', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    window.__starts = []
  })
})

test('les quatre pistes demarrent au meme instant, a l echantillon pres', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  const starts = await page.evaluate(() => window.__starts)
  expect(starts).toHaveLength(4)

  const instants = [...new Set(starts.map((start) => start.when))]
  expect(instants).toHaveLength(1)

  const offsets = [...new Set(starts.map((start) => start.offset))]
  expect(offsets).toEqual([0])
})

test('un seek replanifie les quatre pistes sur un instant unique', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()
  await page.waitForTimeout(700)

  await page.evaluate(() => {
    window.__starts = []
  })
  await page.locator('body').press('ArrowRight')
  await page.waitForTimeout(200)

  const starts = await page.evaluate(() => window.__starts)
  expect(starts).toHaveLength(4)
  expect([...new Set(starts.map((s) => s.when))]).toHaveLength(1)
  // Un unique offset : aucune piste ne repart d'un point different des autres.
  expect([...new Set(starts.map((s) => s.offset))]).toHaveLength(1)
})

test('une serie de seeks n accumule aucune derive', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  for (const _ of [1, 2, 3, 4, 5]) {
    await page.waitForTimeout(150)
    await page.evaluate(() => {
      window.__starts = []
    })
    await page.locator('body').press('ArrowRight')
    await page.locator('body').press('ArrowLeft')
    await page.waitForTimeout(120)

    const starts = await page.evaluate(() => window.__starts)
    // Deux replanifications de quatre pistes, chacune sur un instant unique.
    expect(starts).toHaveLength(8)
    const first = starts.slice(0, 4)
    const second = starts.slice(4)
    expect([...new Set(first.map((s) => s.when))]).toHaveLength(1)
    expect([...new Set(first.map((s) => s.offset))]).toHaveLength(1)
    expect([...new Set(second.map((s) => s.when))]).toHaveLength(1)
    expect([...new Set(second.map((s) => s.offset))]).toHaveLength(1)
  }
})

test('la position suit l horloge audio sans deriver', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  // On echantillonne jusqu'a ce que la lecture ait franchi deux secondes, plutot
  // que pendant une duree fixe : sous charge, la machine peut mettre plus
  // longtemps a demarrer l'audio, sans que la propriete testee change.
  const samples = await page.evaluate(async () => {
    const readDisplayed = () => {
      const text = document.querySelector('p.tabular-nums span')?.textContent ?? '0:00.0'
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

  // La lecture a reellement avance.
  expect(samples.length).toBeGreaterThan(3)
  expect(samples.at(-1)?.displayed ?? 0).toBeGreaterThan(2)

  // L'ecart entre horloge audio et position affichee reste constant : c'est la
  // definition d'une absence de derive. La tolerance couvre l'arrondi au dixieme
  // de seconde de l'affichage et le lookahead de planification.
  const deltas = samples.map((sample) => sample.audio - sample.displayed)
  const spread = Math.max(...deltas) - Math.min(...deltas)
  expect(spread).toBeLessThan(0.3)
})
