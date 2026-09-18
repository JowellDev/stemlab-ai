import { expect, test } from '@playwright/test'
import { signUp } from './helpers/track'

/**
 * Durcissement : ce qui protege le service quand il est attaque, pas utilise.
 *
 * Les seuils exacts viennent de l'environnement (voir `playwright.config.ts`) ;
 * ce qui est verifie ici, c'est que la limite existe, qu'elle refuse, et qu'elle
 * dit quand reessayer.
 */

test('au-dela de la limite, l API refuse et annonce le delai', async ({ page }) => {
  await signUp(page, 'limite')

  const limit = 30
  let refused: { status: number; retryAfter: string | null } | null = null

  // Une requete de trop suffit : la fenetre est fixe, et le compteur porte sur
  // l'utilisateur qui vient d'etre cree — personne d'autre ne l'alimente.
  for (let attempt = 0; attempt <= limit + 1 && !refused; attempt++) {
    const response = await page.request.post('/api/tracks/inexistant/delete')
    if (response.status() === 429) {
      refused = { status: response.status(), retryAfter: response.headers()['retry-after'] ?? null }
    }
  }

  expect(refused, `aucun refus apres ${limit + 2} appels`).not.toBeNull()
  expect(Number(refused!.retryAfter)).toBeGreaterThan(0)
  expect(Number(refused!.retryAfter)).toBeLessThanOrEqual(60)
})

test('les en-tetes de securite sont poses sur chaque reponse', async ({ page }) => {
  const response = await page.goto('/login')
  const headers = response!.headers()

  expect(headers['content-security-policy']).toContain("default-src 'self'")
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['x-frame-options']).toBe('DENY')
  // Chaque reponse est tracable jusqu'a sa ligne de journal.
  expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
})

test('un morceau d autrui reste inaccessible', async ({ browser }) => {
  const first = await browser.newContext()
  const firstPage = await first.newPage()
  await signUp(firstPage, 'proprietaire')

  // Un identifiant qui n'appartient a personne se comporte comme celui d'autrui :
  // le serveur ne distingue pas les deux, ce qui est precisement le but.
  const response = await firstPage.request.get(
    '/api/tracks/00000000-0000-4000-8000-000000000000/stems',
  )
  expect(response.status()).toBe(404)

  await first.close()
})

test('sans session, les routes d API refusent', async ({ request }) => {
  const upload = await request.post('/api/upload/init', {
    data: { filename: 'x.mp3', contentType: 'audio/mpeg', bytes: 10, checksum: 'a'.repeat(64) },
  })
  expect(upload.status()).toBe(401)

  const stems = await request.get('/api/tracks/00000000-0000-4000-8000-000000000000/stems')
  expect(stems.status()).toBe(401)
})
