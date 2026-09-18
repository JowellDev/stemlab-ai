import { join } from 'node:path'
import { type Page, expect } from '@playwright/test'
import { waitForHydration } from './hydration'

/** Extrait de reference : sa grille d'accords est nette et sa duree courte. */
export const FIXTURE = join(import.meta.dirname, '../../../../fixtures/tracks/ballade.flac')

/**
 * Extrait de parole du domaine public, pour ce qui touche aux paroles.
 *
 * Les morceaux de synthese n'ont rien a transcrire : verifier la transcription
 * demande de la vraie voix.
 */
export const SPEECH_FIXTURE = join(
  import.meta.dirname,
  '../../../../fixtures/tracks/discours-en.flac',
)

/** Marge large : le traitement CPU d'un extrait de 19 s prend une vingtaine de secondes. */
export const PROCESSING_TIMEOUT_MS = 180_000

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemple.fr`
}

export async function signUp(page: Page, prefix?: string): Promise<void> {
  await page.goto('/signup')

  // React remet les champs controles a leur etat initial en s'hydratant : une
  // saisie anterieure est effacee, et le formulaire part vide. Attendre le
  // marqueur est le seul moyen fiable de l'eviter.
  await waitForHydration(page)

  await page.getByLabel('Nom').fill('Camille Durand')
  await page.getByLabel('Adresse electronique').fill(uniqueEmail(prefix))
  await page.getByLabel('Mot de passe').fill('motdepasse-solide')
  await page.getByRole('button', { name: 'Creer mon compte' }).click()
  await expect(page.getByRole('heading', { name: 'Ma bibliotheque' })).toBeVisible()
}

/**
 * Cree un compte, depose le morceau de reference, attend son traitement et ouvre
 * sa page. Le traitement peut etre instantane si le pipeline a deja vu ce fichier :
 * c'est le cas nominal de la deduplication, et le resultat est le meme.
 */
export async function openReadyTrack(
  page: Page,
  options: { fixture?: string; name?: string } = {},
): Promise<void> {
  const fixture = options.fixture ?? FIXTURE
  const name = options.name ?? 'ballade'

  await signUp(page, 'chords')

  await page.setInputFiles('input[type="file"]', fixture)
  const card = page.getByRole('listitem').filter({ hasText: name })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card.getByText('Pret', { exact: true })).toBeVisible({
    timeout: PROCESSING_TIMEOUT_MS,
  })

  await card.getByRole('link', { name: new RegExp(name, 'i') }).click()

  // « Pret » apparait aussi sur la carte de la bibliotheque : attendre ce texte
  // laisserait le test agir avant que la page du morceau ne soit montee. On attend
  // donc ce qui n'existe que sur cette page — le transport, une fois les stems
  // decodes.
  await expect(page.getByRole('button', { name: 'Lire' })).toBeEnabled({ timeout: 60_000 })
  await expect(page.getByTestId('playback-position')).toBeVisible()
}
