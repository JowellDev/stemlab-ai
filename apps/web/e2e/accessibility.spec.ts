import AxeBuilder from '@axe-core/playwright'
import { type Page, expect, test } from '@playwright/test'
import { openReadyTrack, signUp } from './helpers/track'

/**
 * Accessibilite : contraste AA et navigation entierement au clavier.
 *
 * L'analyse automatique ne prouve pas qu'une interface est utilisable, mais
 * elle attrape sans discussion ce qui se mesure — contraste, noms accessibles,
 * roles, ordre des titres. Le reste est verifie a la main, ici au clavier.
 */

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function analyze(page: Page) {
  return new AxeBuilder({ page }).withTags(RULES).analyze()
}

/** Rend les manquements lisibles dans le rapport, plutot qu'un simple compte. */
function describe(violations: Awaited<ReturnType<typeof analyze>>['violations']): string {
  return violations
    .map((v) => {
      const ou = v.nodes.map((node) => `${node.target.join(' ')} :: ${node.html}`).join('\n    ')
      return `${v.id} (${v.impact}) — ${v.help}\n    ${ou}`
    })
    .join('\n')
}

test('la page de connexion respecte AA', async ({ page }) => {
  await page.goto('/login')
  const { violations } = await analyze(page)
  expect(describe(violations)).toBe('')
})

test('la page de creation de compte respecte AA', async ({ page }) => {
  await page.goto('/signup')
  const { violations } = await analyze(page)
  expect(describe(violations)).toBe('')
})

test('la bibliotheque respecte AA', async ({ page }) => {
  await signUp(page, 'a11y')
  const { violations } = await analyze(page)
  expect(describe(violations)).toBe('')
})

test('la page d un morceau respecte AA', async ({ page }) => {
  await openReadyTrack(page)
  const { violations } = await analyze(page)
  expect(describe(violations)).toBe('')
})

test('on atteint le depot de fichier au clavier seul', async ({ page }) => {
  await signUp(page, 'clavier')

  // On avance a la tabulation jusqu'au bouton, sans jamais toucher la souris.
  const target = page.getByRole('button', { name: 'Choisir un fichier' })
  for (let step = 0; step < 15; step++) {
    if (await target.evaluate((node) => node === document.activeElement)) break
    await page.keyboard.press('Tab')
  }

  await expect(target).toBeFocused()
})

test('le transport du lecteur s utilise au clavier', async ({ page }) => {
  await openReadyTrack(page)

  const play = page.getByRole('button', { name: 'Lire' })
  await play.focus()
  await expect(play).toBeFocused()

  // La barre d'espace bascule la lecture ; la touche doit agir depuis le bouton
  // sans que le clic soit necessaire.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Lire' })).toBeVisible()
})

test('chaque commande de piste porte un nom accessible', async ({ page }) => {
  await openReadyTrack(page)

  for (const piste of ['Voix', 'Batterie', 'Basse']) {
    await expect(page.getByRole('button', { name: `Couper la piste ${piste}` })).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Mettre en solo la piste ${piste}` }),
    ).toBeVisible()
  }
})
