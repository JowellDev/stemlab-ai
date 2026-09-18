import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { readPosition } from './helpers/position'
import { PROCESSING_TIMEOUT_MS, signUp } from './helpers/track'

/**
 * Paroles et traduction.
 *
 * L'extrait est un enregistrement de parole du domaine public : les morceaux de
 * synthese des autres tests n'ont rien a transcrire. La transcription porte sur
 * le stem de voix deja isole, ce qui est tout l'interet — une voix debarrassee du
 * reste se transcrit nettement mieux que le mixage.
 */

const SPEECH = join(import.meta.dirname, '../../../fixtures/tracks/discours-en.flac')

test.describe.configure({ mode: 'serial' })

test('un morceau chante affiche ses paroles et sa traduction', async ({ page }) => {
  test.setTimeout(PROCESSING_TIMEOUT_MS + 180_000)

  await signUp(page, 'paroles')
  await waitForHydration(page)
  await page.setInputFiles('input[type="file"]', SPEECH)

  const card = page.getByRole('listitem').filter({ hasText: 'discours' })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card.getByText('Pret', { exact: true })).toBeVisible({
    timeout: PROCESSING_TIMEOUT_MS,
  })

  await card.getByRole('link', { name: /discours/i }).click()
  await expect(page.getByRole('button', { name: 'Lire' })).toBeEnabled({ timeout: 60_000 })

  // --- transcription -------------------------------------------------------
  const lyrics = page.getByRole('region', { name: 'Paroles' })
  await expect(lyrics).toBeVisible()
  await expect(lyrics).toContainText('Anglais')
  await expect(page.getByTestId('lyrics-lines')).toContainText('ask not what your country')

  // --- traduction ----------------------------------------------------------
  await lyrics.getByRole('button', { name: 'Francais' }).click()
  await expect(page.getByTestId('lyrics-lines')).toContainText('votre pays')

  await lyrics.getByRole('button', { name: 'Aucune' }).click()
  await expect(page.getByTestId('lyrics-lines')).not.toContainText('votre pays')

  // --- accessibilite -------------------------------------------------------
  // Le panneau de paroles n'existe pas sur les morceaux instrumentaux : c'est le
  // seul endroit ou il puisse etre analyse.
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(violations.map((v) => `${v.id} — ${v.help}`)).toEqual([])
})

test('la ligne active suit la lecture et un clic y deplace la tete', async ({ page }) => {
  test.setTimeout(PROCESSING_TIMEOUT_MS + 180_000)

  await signUp(page, 'paroles-suivi')
  await waitForHydration(page)
  await page.setInputFiles('input[type="file"]', SPEECH)

  const card = page.getByRole('listitem').filter({ hasText: 'discours' })
  await expect(card.getByText('Pret', { exact: true })).toBeVisible({
    timeout: PROCESSING_TIMEOUT_MS,
  })
  await card.getByRole('link', { name: /discours/i }).click()
  await expect(page.getByRole('button', { name: 'Lire' })).toBeEnabled({ timeout: 60_000 })

  const lignes = page.getByTestId('lyrics-lines').getByRole('button')
  const total = await lignes.count()
  expect(total).toBeGreaterThan(1)

  // Cliquer la derniere ligne deplace la lecture a son debut : la position
  // affichee doit sauter en avant, et c'est cette ligne qui devient active.
  await lignes.nth(total - 1).click()
  await expect(lignes.nth(total - 1)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => readPosition(page)).toBeGreaterThan(1)
})
