import { existsSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { type Page, expect, test } from '@playwright/test'
import { signUp } from './helpers/track'

/**
 * Pad d'accords tenus.
 *
 * Le son est synthetise dans le navigateur : rien a telecharger, rien a
 * decoder. Ce qui se verifie de l'exterieur, c'est la grille — qu'elle suive la
 * tonalite — et le fait que des oscillateurs soient reellement demarres. Sans
 * cette seconde verification, un pad muet passerait tous les tests d'interface.
 */

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

/** Compte les oscillateurs demarres depuis le chargement de la page. */
async function countOscillators(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as { __oscillators?: number }).__oscillators ?? 0)
}

async function openPad(page: Page): Promise<void> {
  await signUp(page, 'pad')

  // L'instrumentation doit etre en place avant que la page ne cree son contexte
  // audio : on l'installe sur le document, puis on navigue.
  await page.addInitScript(() => {
    const start = OscillatorNode.prototype.start
    const target = globalThis as { __oscillators?: number }
    target.__oscillators = 0
    OscillatorNode.prototype.start = function patched(this: OscillatorNode, when?: number) {
      target.__oscillators = (target.__oscillators ?? 0) + 1
      return start.call(this, when)
    }
  })

  await page.goto('/pad')
  await expect(page.getByRole('heading', { name: "Pad d'accords" })).toBeVisible()
}

const grid = (page: Page) => page.getByTestId('pad-grid').getByRole('button')

test('la grille suit la tonalite choisie', async ({ page }) => {
  await openPad(page)

  await expect(page.getByTestId('pad-key')).toHaveText('C majeur')
  await expect(grid(page)).toHaveText([
    /^C\s*I$/,
    /^Dm\s*ii$/,
    /^Em\s*iii$/,
    /^F\s*IV$/,
    /^G\s*V$/,
    /^Am\s*vi$/,
    /^Bdim\s*vii°$/,
    /^Bb\s*bVII$/,
  ])

  await page
    .getByRole('group', { name: 'Fondamentale' })
    .getByRole('button', { name: 'G', exact: true })
    .click()

  await expect(page.getByTestId('pad-key')).toHaveText('G majeur')
  // En sol majeur, le septieme degre est fa diese — et le bVII, fa becarre.
  await expect(grid(page).nth(6)).toContainText('F#dim')
  await expect(grid(page).nth(7)).toContainText('F')
})

test('le mode mineur change la grille', async ({ page }) => {
  await openPad(page)

  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Mineur' }).click()
  await page
    .getByRole('group', { name: 'Fondamentale' })
    .getByRole('button', { name: 'A', exact: true })
    .click()

  await expect(page.getByTestId('pad-key')).toHaveText('A mineur')
  await expect(grid(page).first()).toContainText('Am')
  // Les deux dominantes sont proposees : le v naturel et le V emprunte.
  await expect(grid(page).nth(4)).toContainText('Em')
  await expect(grid(page).nth(7)).toContainText('E')
})

test('la couleur enrichit toute la grille', async ({ page }) => {
  await openPad(page)

  await page.getByRole('button', { name: 'sus4', exact: true }).click()
  await expect(grid(page).first()).toContainText('Csus4')
  await expect(grid(page).nth(1)).toContainText('Dsus4')

  await page.getByRole('button', { name: '7e', exact: true }).click()
  await expect(grid(page).first()).toContainText('Cmaj7')
  await expect(grid(page).nth(1)).toContainText('Dm7')
})

test('toucher un accord le fait sonner et le tient', async ({ page }) => {
  await openPad(page)

  expect(await countOscillators(page)).toBe(0)

  await grid(page).first().click()

  // Des oscillateurs demarrent : le pad sonne vraiment, il ne fait pas
  // qu'allumer un bouton.
  await expect.poll(() => countOscillators(page)).toBeGreaterThan(0)
  await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'true')
})

test('un second accord remplace le premier', async ({ page }) => {
  await openPad(page)

  await grid(page).first().click()
  await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'true')

  await grid(page).nth(3).click()

  await expect(grid(page).nth(3)).toHaveAttribute('aria-pressed', 'true')
  await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'false')
})

test('retoucher l accord tenu le laisse mourir', async ({ page }) => {
  await openPad(page)

  await grid(page).first().click()
  await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'true')

  await grid(page).first().click()
  await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'false')
})

test('le bouton de silence relache l accord', async ({ page }) => {
  await openPad(page)

  const silence = page.getByRole('button', { name: 'Laisser mourir' })
  await expect(silence).toBeDisabled()

  await grid(page).first().click()
  await expect(silence).toBeEnabled()

  await silence.click()
  await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'false')
  await expect(silence).toBeDisabled()
})

test('changer de timbre s entend sans attendre l accord suivant', async ({ page }) => {
  await openPad(page)

  await grid(page).first().click()
  const avant = await countOscillators(page)

  await page.getByRole('button', { name: 'Orgue' }).click()

  // L'accord en cours est rejoue avec le nouveau timbre : sinon le bouton
  // semblerait sans effet.
  await expect.poll(() => countOscillators(page)).toBeGreaterThan(avant)
  await expect(page.getByTestId('pad-voice-hint')).toContainText('tirettes')
})

test('le pad respecte AA', async ({ page }) => {
  await openPad(page)
  await grid(page).first().click()

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(violations.map((v) => `${v.id} — ${v.help}`)).toEqual([])
})

test('le pad s utilise au clavier', async ({ page }) => {
  await openPad(page)

  const premier = grid(page).first()
  await premier.focus()
  await page.keyboard.press('Enter')

  await expect(premier).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => countOscillators(page)).toBeGreaterThan(0)
})

// --- source echantillonnee -------------------------------------------------

/**
 * La banque n'est pas versionnee : vingt-quatre megaoctets dans l'historique Git
 * penaliseraient chaque clone. Sans elle, ces tests sont ignores plutot que
 * rouges — leur echec ne dirait rien du code.
 */
async function bankAvailable(page: Page): Promise<boolean> {
  const response = await page.request.head('/soundfonts/FluidR3Mono_GM.sf3')
  return response.ok()
}

test.describe('echantillons', () => {
  test.slow()

  test('basculer sur les echantillons charge la banque et ses instruments', async ({ page }) => {
    await openPad(page)
    test.skip(!(await bankAvailable(page)), 'banque absente : lancer `pnpm soundfont`')

    await page.getByRole('button', { name: 'Echantillons' }).click()

    const instrument = page.getByRole('combobox', { name: /Instrument/i })
    await expect(instrument).toBeVisible({ timeout: 120_000 })
    await expect(instrument.getByRole('option')).not.toHaveCount(0)
  })

  test('un accord echantillonne ne passe pas par les oscillateurs', async ({ page }) => {
    await openPad(page)
    test.skip(!(await bankAvailable(page)), 'banque absente : lancer `pnpm soundfont`')

    await page.getByRole('button', { name: 'Echantillons' }).click()
    await expect(page.getByRole('combobox', { name: /Instrument/i })).toBeVisible({
      timeout: 120_000,
    })

    const avant = await countOscillators(page)
    await grid(page).first().click()
    await expect(grid(page).first()).toHaveAttribute('aria-pressed', 'true')

    // La preuve que c'est bien la banque qui joue : aucun oscillateur de plus.
    // Un simple changement d'etat du bouton ne prouverait rien.
    await page.waitForTimeout(500)
    expect(await countOscillators(page)).toBe(avant)
  })

  test('revenir a la synthese refait sonner les oscillateurs', async ({ page }) => {
    await openPad(page)
    test.skip(!(await bankAvailable(page)), 'banque absente : lancer `pnpm soundfont`')

    await page.getByRole('button', { name: 'Echantillons' }).click()
    await expect(page.getByRole('combobox', { name: /Instrument/i })).toBeVisible({
      timeout: 120_000,
    })
    await grid(page).first().click()

    const avant = await countOscillators(page)
    await page.getByRole('button', { name: 'Synthese' }).click()
    await grid(page).nth(2).click()

    await expect.poll(() => countOscillators(page)).toBeGreaterThan(avant)
  })

  test('la douceur ne s applique pas aux echantillons', async ({ page }) => {
    await openPad(page)
    test.skip(!(await bankAvailable(page)), 'banque absente : lancer `pnpm soundfont`')

    const douceur = page.getByRole('slider', { name: 'Douceur du fondu' })
    await expect(douceur).toBeEnabled()

    await page.getByRole('button', { name: 'Echantillons' }).click()

    // Les fondus viennent des enveloppes de la banque : laisser un reglage actif
    // mais sans effet serait plus trompeur que de le desactiver.
    await expect(douceur).toBeDisabled()
  })

  test('le pad echantillonne respecte AA', async ({ page }) => {
    await openPad(page)
    test.skip(!(await bankAvailable(page)), 'banque absente : lancer `pnpm soundfont`')

    await page.getByRole('button', { name: 'Echantillons' }).click()
    await expect(page.getByRole('combobox', { name: /Instrument/i })).toBeVisible({
      timeout: 120_000,
    })

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(violations.map((v) => `${v.id} — ${v.help}`)).toEqual([])
  })
})

// --- nappes personnelles ---------------------------------------------------

/**
 * Deux fichiers reels, nommes comme le font les bibliotheques du commerce :
 * la tonalite est dans le nom, et doit etre reconnue sans intervention.
 */
const PADS = [
  join(import.meta.dirname, '../../../pad-previews/ambient-chords-pads-calming-soothing_F_major.wav'),
  join(import.meta.dirname, '../../../pad-previews/heavenly-trap-chords-pads-dreamy_70bpm_F_major.wav'),
]

async function importPads(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mes nappes' }).click()
  await page.setInputFiles('input[aria-label="Fichiers de nappes"]', PADS)
  await expect(page.getByTestId('pad-library').getByRole('listitem')).toHaveCount(2, {
    timeout: 30_000,
  })
}

test.describe('nappes personnelles', () => {
  test.skip(!existsSync(PADS[0]!), 'aucun fichier de nappe dans pad-previews')

  test('les fichiers importes gardent leur tonalite', async ({ page }) => {
    await openPad(page)
    await importPads(page)

    const tonalites = page.getByTestId('pad-library').getByRole('combobox')
    // `…_F_major.wav` : la tonalite est lisible dans le nom.
    await expect(tonalites.first()).toHaveValue('5-major')
    await expect(tonalites.nth(1)).toHaveValue('5-major')
  })

  test('une tonalite sans nappe est annoncee', async ({ page }) => {
    await openPad(page)
    await importPads(page)

    // La page ouvre en do majeur, et aucune nappe ne couvre cette tonalite.
    await expect(page.getByText(/Aucune nappe pour/)).toBeVisible()

    await page
      .getByRole('group', { name: 'Fondamentale' })
      .getByRole('button', { name: 'F', exact: true })
      .click()

    await expect(page.getByText(/Aucune nappe pour/)).toBeHidden()
  })

  test('toucher un accord lit le fichier, pas des oscillateurs', async ({ page }) => {
    await openPad(page)
    await importPads(page)
    await page
      .getByRole('group', { name: 'Fondamentale' })
      .getByRole('button', { name: 'F', exact: true })
      .click()

    // Le rangement du fichier precede son decodage : tant que l'avertissement
    // est la, la nappe n'est pas encore jouable.
    await expect(page.getByText(/Aucune nappe pour/)).toBeHidden({ timeout: 30_000 })

    const avant = await countOscillators(page)
    await page.evaluate(() => {
      const start = AudioBufferSourceNode.prototype.start
      const cible = globalThis as { __sources?: number }
      cible.__sources = 0
      AudioBufferSourceNode.prototype.start = function patched(
        this: AudioBufferSourceNode,
        ...args: Parameters<AudioBufferSourceNode['start']>
      ) {
        cible.__sources = (cible.__sources ?? 0) + 1
        return start.apply(this, args)
      }
    })

    await grid(page).first().click()

    // Un fichier demarre, aucun oscillateur : la source est bien la bibliotheque.
    await expect
      .poll(() => page.evaluate(() => (globalThis as { __sources?: number }).__sources ?? 0))
      .toBeGreaterThan(0)
    expect(await countOscillators(page)).toBe(avant)
  })

  test('retirer une nappe la fait disparaitre', async ({ page }) => {
    await openPad(page)
    await importPads(page)

    const premiere = page.getByTestId('pad-library').getByRole('listitem').first()
    await premiere.getByRole('button', { name: /^Retirer / }).click()

    await expect(page.getByTestId('pad-library').getByRole('listitem')).toHaveCount(1)
  })

  test('les reglages sans effet sur les fichiers sont desactives', async ({ page }) => {
    await openPad(page)
    await page.getByRole('button', { name: 'Mes nappes' }).click()

    // Les fondus et le timbre appartiennent aux enregistrements : laisser ces
    // reglages actifs mais sans effet serait trompeur.
    await expect(page.getByRole('slider', { name: 'Douceur du fondu' })).toBeDisabled()
    await expect(page.getByRole('slider', { name: /Duree du fondu/ })).toBeEnabled()
  })

  test('la bibliotheque respecte AA', async ({ page }) => {
    await openPad(page)
    await importPads(page)

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(violations.map((v) => `${v.id} — ${v.help}`)).toEqual([])
  })
})
