import { type Page, expect, test } from '@playwright/test'
import { PROCESSING_TIMEOUT_MS, openReadyTrack } from './helpers/track'
import { readPosition } from './helpers/position'

/**
 * Alignement des accords.
 *
 * La propriete verifiee est la meme dans tous les cas : **l'accord mis en avant
 * doit contenir la position de lecture dans ses propres bornes**. C'est une
 * verification auto-referente — chaque accord porte son intervalle — et elle vaut
 * quelle que soit la cause d'un desalignement : seek, tempo, transposition.
 */

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  // Le premier test de la serie declenche un vrai traitement ML : le delai par
  // defaut du fichier de configuration le tronquerait.
  test.setTimeout(PROCESSING_TIMEOUT_MS + 60_000)
  await openReadyTrack(page)
  await page.getByRole('button', { name: 'Ligne de temps' }).click()
})

test('la tonalite et le tempo sont affiches', async ({ page }) => {
  await expect(page.getByText('Tonalite')).toBeVisible()
  await expect(page.getByText('Tempo', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Mesure')).toBeVisible()
  await expect(page.getByText(/\d+ BPM/)).toBeVisible()
})

test('les deux vues sont disponibles', async ({ page }) => {
  await page.getByRole('button', { name: 'Grille' }).click()
  await expect(page.getByLabel(/Grille d'accords/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Mesure 1/ })).toBeVisible()

  await page.getByRole('button', { name: 'Ligne de temps' }).click()
  await expect(page.getByLabel("Suite d'accords")).toBeVisible()
})

test("l'accord actif contient la position, des le demarrage", async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()
  await expect.poll(() => readPosition(page)).toBeGreaterThan(0.5)

  await expectAligned(page)
})

test("l'accord actif reste aligne apres un seek", async ({ page }) => {
  for (const target of [5, 12, 3, 9]) {
    await seekTo(page, target)
    await expectAligned(page)
  }
})

test("l'accord actif reste aligne apres un changement de tempo", async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  await setTempo(page, 0.75)
  await expect.poll(() => readPosition(page)).toBeGreaterThan(1)
  await expectAligned(page)

  // La position est exprimee dans le temps du morceau : ralentir la lecture ne
  // doit donc demander aucun realignement.
  await setTempo(page, 1.25)
  const before = await readPosition(page)
  await expect.poll(() => readPosition(page)).toBeGreaterThan(before + 1)
  await expectAligned(page)
})

test("l'accord actif reste aligne apres une transposition", async ({ page }) => {
  await seekTo(page, 7)
  const before = await activeChord(page)

  await page.getByRole('button', { name: 'Transposer un demi-ton plus haut' }).click()
  await page.getByRole('button', { name: 'Transposer un demi-ton plus haut' }).click()

  const after = await activeChord(page)
  // Les bornes ne bougent pas : seule l'etiquette change.
  expect(after.start).toBeCloseTo(before.start, 2)
  expect(after.end).toBeCloseTo(before.end, 2)
  expect(after.label).not.toBe(before.label)
  await expectAligned(page)
})

test('la transposition decale tous les libelles du meme intervalle', async ({ page }) => {
  const before = await chordLabels(page)
  await page.getByRole('button', { name: 'Transposer un demi-ton plus haut' }).click()
  const after = await chordLabels(page)

  expect(after).toHaveLength(before.length)

  for (const [index, original] of before.entries()) {
    if (original === '—') continue
    const source = splitChord(original)
    const shifted = splitChord(after[index] ?? '')

    // On compare des hauteurs, pas des orthographes : l'application ecrit `Eb`
    // plutot que `D#` quand l'armure obtenue est en bemols, et c'est correct.
    expect(shifted.root).toBe((source.root + 1) % 12)
    expect(shifted.quality).toBe(source.quality)
  }
})

test('la transposition revient a zero', async ({ page }) => {
  const original = await chordLabels(page)

  await page.getByRole('button', { name: 'Transposer un demi-ton plus haut' }).click()
  await page.getByRole('button', { name: /revenir a l'original/ }).click()

  await expect(page.getByRole('button', { name: 'Aucune transposition' })).toBeVisible()
  expect(await chordLabels(page)).toEqual(original)
})

test('cliquer un accord deplace la lecture a son debut', async ({ page }) => {
  const buttons = page.getByLabel("Suite d'accords").getByRole('button')
  const third = buttons.nth(2)
  const range = parseRange((await third.getAttribute('title')) ?? '')

  await third.click()
  await expect.poll(() => readPosition(page)).toBeCloseTo(range.start, 0)
  await expectAligned(page)
})

// --- utilitaires -----------------------------------------------------------

interface ActiveChord {
  label: string
  start: number
  end: number
}

/** L'accord mis en avant doit contenir la position courante dans ses bornes. */
async function expectAligned(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const chord = await activeChord(page)
        const position = await readPosition(page)
        // L'affichage arrondit au dixieme : on tolere cet arrondi aux bornes.
        return position >= chord.start - 0.15 && position < chord.end + 0.15
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

async function activeChord(page: Page): Promise<ActiveChord> {
  const active = page.locator('[data-active="true"]').first()
  await active.waitFor({ timeout: 10_000 })
  const title = (await active.getAttribute('title')) ?? ''
  return { label: (await active.textContent())?.trim() ?? '', ...parseRange(title) }
}

/** Separe un libelle d'accord en hauteur et qualite, dieses et bemols acceptes. */
function splitChord(label: string): { root: number; quality: string } {
  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

  const name = label.match(/^[A-G][#b]?/)?.[0] ?? ''
  const index = SHARPS.indexOf(name)
  const root = index === -1 ? FLATS.indexOf(name) : index

  return { root, quality: label.slice(name.length) }
}

function parseRange(title: string): { start: number; end: number } {
  const match = title.match(/([\d.]+) s a ([\d.]+) s/)
  return { start: Number(match?.[1] ?? 0), end: Number(match?.[2] ?? 0) }
}

async function chordLabels(page: Page): Promise<string[]> {
  return page.getByLabel("Suite d'accords").getByRole('button').allTextContents()
}

async function seekTo(page: Page, seconds: number): Promise<void> {
  await page.locator('body').press('Home')
  await expect.poll(() => readPosition(page)).toBe(0)
  for (let remaining = seconds; remaining > 0; remaining -= 5) {
    await page.locator('body').press('ArrowRight')
  }
  await expect.poll(() => readPosition(page)).toBeGreaterThanOrEqual(seconds)
}

async function setTempo(page: Page, rate: number): Promise<void> {
  const slider = page.getByRole('slider', { name: /^Tempo/ })
  await slider.focus()
  // Le curseur avance par pas de 0,05 depuis sa valeur courante.
  const current = Number(await slider.getAttribute('aria-valuenow'))
  const steps = Math.round((rate - current) / 0.05)
  for (let index = 0; index < Math.abs(steps); index += 1) {
    await slider.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft')
  }
}
