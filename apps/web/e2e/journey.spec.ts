import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { readPosition } from './helpers/position'

/**
 * Parcours complet : inscription -> envoi -> traitement -> lecture.
 *
 * Ce test met en jeu la stack entiere — base de donnees, S3, service ML et worker.
 * Il est ignore quand le service ML ne repond pas, pour que la suite reste
 * utilisable sans lancer tout l'attirail.
 */

const FIXTURE = join(import.meta.dirname, '../../../fixtures/tracks/electro.mp3')
/** Marge large : le traitement CPU d'un extrait de 15 s prend une quinzaine de secondes. */
const PROCESSING_TIMEOUT_MS = 180_000

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

test.beforeAll(async () => {
  const reachable = await fetch('http://127.0.0.1:8000/health')
    .then((response) => response.ok)
    .catch(() => false)
  test.skip(!reachable, 'service ML injoignable sur :8000')

  try {
    readFileSync(FIXTURE)
  } catch {
    test.skip(true, 'fixture absente — lancer scripts/make-test-tracks.py')
  }
})

function uniqueEmail(): string {
  return `parcours-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemple.fr`
}

test.describe.configure({ mode: 'serial' })

test('inscription, envoi, traitement puis lecture', async ({ page }) => {
  test.setTimeout(PROCESSING_TIMEOUT_MS + 120_000)

  // --- inscription ---------------------------------------------------------
  await page.goto('/signup')
  await page.getByLabel('Nom').fill('Camille Durand')
  await page.getByLabel('Adresse electronique').fill(uniqueEmail())
  await page.getByLabel('Mot de passe').fill('motdepasse-solide')
  await page.getByRole('button', { name: 'Creer mon compte' }).click()

  await expect(page.getByRole('heading', { name: 'Ma bibliotheque' })).toBeVisible()
  await expect(page.getByText('Aucun morceau pour le moment.')).toBeVisible()

  // --- envoi ---------------------------------------------------------------
  await page.setInputFiles('input[type="file"]', FIXTURE)

  // Le morceau apparait dans la bibliotheque des la mise en file.
  const card = page.getByRole('listitem').filter({ hasText: 'electro' })
  await expect(card).toBeVisible({ timeout: 60_000 })

  // --- traitement ----------------------------------------------------------
  // L'etat passe a « Pret » sans rechargement : c'est le flux SSE qui le pousse.
  await expect(card.getByText('Pret', { exact: true })).toBeVisible({
    timeout: PROCESSING_TIMEOUT_MS,
  })

  // L'analyse est remontee par le webhook et affichee apres revalidation.
  await expect(card.getByText(/BPM/)).toBeVisible({ timeout: 30_000 })

  // --- lecture -------------------------------------------------------------
  await card.getByRole('link', { name: /electro/i }).click()

  await expect(page.getByRole('button', { name: 'Lire' })).toBeEnabled({ timeout: 60_000 })
  for (const label of ['Voix', 'Batterie', 'Basse', 'Autres']) {
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()
  await expect.poll(() => readPosition(page), { timeout: 15_000 }).toBeGreaterThan(0.5)

  // --- suppression ---------------------------------------------------------
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('navigation').getByRole('link', { name: 'Ma bibliotheque' }).click()
  await expect(page.getByRole('heading', { name: 'Ma bibliotheque' })).toBeVisible()

  await page.getByRole('button', { name: /^Supprimer / }).click()
  await expect(page.getByText('Aucun morceau pour le moment.')).toBeVisible({ timeout: 30_000 })
})

test('un fichier non audio est refuse sans quitter la page', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Nom').fill('Test Refus')
  await page.getByLabel('Adresse electronique').fill(uniqueEmail())
  await page.getByLabel('Mot de passe').fill('motdepasse-solide')
  await page.getByRole('button', { name: 'Creer mon compte' }).click()
  await expect(page.getByRole('heading', { name: 'Ma bibliotheque' })).toBeVisible()

  await page.setInputFiles('input[type="file"]', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ceci n est pas de l audio'),
  })

  await expect(page.getByRole('alert')).toContainText('Format non pris en charge')
  await expect(page.getByText('Aucun morceau pour le moment.')).toBeVisible()
})
