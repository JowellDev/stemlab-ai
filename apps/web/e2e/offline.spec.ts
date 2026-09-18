import { type Page, expect, test } from '@playwright/test'
import { readPosition } from './helpers/position'
import { waitForHydration } from './helpers/hydration'
import { FIXTURE, PROCESSING_TIMEOUT_MS, openReadyTrack, signUp } from './helpers/track'

/**
 * Definition of Done de la phase 7 : un morceau telecharge se lit integralement
 * en mode avion.
 *
 * Le reseau est coupe au niveau du contexte du navigateur — pas simule dans
 * l'application : toute requete sortante echoue reellement, comme en vol.
 */

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
})

test.describe.configure({ mode: 'serial' })

test('le manifeste declare une application installable', async ({ page }) => {
  await page.goto('/')
  const href = await page.getAttribute('link[rel="manifest"]', 'href')
  expect(href).toBe('/manifest.webmanifest')

  const manifest = await (await page.request.get(href!)).json()

  expect(manifest.name).toContain('STEMLAB')
  expect(manifest.short_name).toBe('STEMLAB')
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/library')
  expect(manifest.theme_color).toBeTruthy()
  expect(manifest.background_color).toBeTruthy()

  // Les tailles exigees par Android, plus les variantes rognables.
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
  expect(sizes).toContain('192x192')
  expect(sizes).toContain('512x512')

  const maskable = manifest.icons.filter(
    (icon: { purpose?: string }) => icon.purpose === 'maskable',
  )
  expect(maskable.length).toBeGreaterThanOrEqual(2)
})

test('les icones sont servies et de la bonne taille', async ({ page }) => {
  for (const [name, expected] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-192.png', 192],
    ['icon-maskable-512.png', 512],
  ] as const) {
    const response = await page.request.get(`/icons/${name}`)
    expect(response.ok(), name).toBe(true)
    expect(response.headers()['content-type']).toContain('image/png')

    const size = pngSize(Buffer.from(await response.body()))
    expect(size, name).toEqual({ width: expected, height: expected })
  }
})

test('le service worker est enregistre et actif', async ({ page }) => {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 30_000,
    })
    .toBe(true)
})

test('un morceau telecharge se lit en mode avion', async ({ page, context }) => {
  test.setTimeout(PROCESSING_TIMEOUT_MS + 180_000)

  await openReadyTrack(page)
  await waitForController(page)

  // --- telechargement ------------------------------------------------------
  const before = await estimate(page)
  await page.getByRole('button', { name: /Rendre .* disponible hors connexion/ }).click()

  // Le quota du navigateur est joint a l'echec : sans lui, un refus pour place
  // insuffisante ne se distingue pas d'un telechargement qui n'a jamais demarre.
  await expect(
    page.getByRole('button', { name: /disponible hors connexion — retirer/ }),
    `stockage avant telechargement : ${before}`,
  ).toBeVisible({ timeout: 120_000 })

  // Les stems sont bien dans le stockage local, pas seulement en cache HTTP.
  expect(await storedTrackCount(page)).toBe(1)

  // --- mode avion ----------------------------------------------------------
  await context.setOffline(true)
  await page.reload()

  await expect(page.getByTestId('offline-indicator')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Lire' })).toBeEnabled({ timeout: 60_000 })

  // --- lecture -------------------------------------------------------------
  for (const label of ['Voix', 'Batterie', 'Basse', 'Autres']) {
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()
  await expect.poll(() => readPosition(page), { timeout: 20_000 }).toBeGreaterThan(1)

  // Le seek fonctionne aussi : les octets sont bien tous la, pas seulement le debut.
  await page.locator('body').press('ArrowRight')
  await expect.poll(() => readPosition(page)).toBeGreaterThan(4)

  await context.setOffline(false)
})

test('un morceau non telecharge ne pretend pas etre disponible', async ({ page, context }) => {
  test.setTimeout(PROCESSING_TIMEOUT_MS + 120_000)

  await openReadyTrack(page)
  await waitForController(page)
  await expect(
    page.getByRole('button', { name: /Rendre .* disponible hors connexion/ }),
  ).toBeVisible()

  expect(await storedTrackCount(page)).toBe(0)

  await context.setOffline(true)
  await page.reload()

  // Le morceau n'ayant jamais ete telecharge, rien ne peut le jouer : le
  // service worker sert la page de repli plutot que de laisser croire a une
  // lecture possible.
  await expect(page.getByTestId('offline-fallback')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Lire' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ouvrir ma bibliotheque' })).toBeVisible()

  await context.setOffline(false)
})

test('un envoi lance sans reseau repart au retour de la connexion', async ({ page, context }) => {
  test.setTimeout(PROCESSING_TIMEOUT_MS + 120_000)

  await signUp(page, 'file-attente')
  await waitForController(page)
  await waitForHydration(page)

  await context.setOffline(true)
  await page.setInputFiles('input[type="file"]', FIXTURE)

  // Le fichier est conserve localement, et rien ne laisse croire a un envoi.
  const queue = page.getByTestId('upload-queue')
  await expect(queue).toContainText('1 envoi en attente de connexion', { timeout: 30_000 })
  await expect(queue).toContainText('ballade')
  await expect(page.getByText('Aucun morceau pour le moment.')).toBeVisible()

  await context.setOffline(false)

  // Le retour du reseau suffit : aucune action de l'utilisateur.
  await expect(queue).toBeHidden({ timeout: 60_000 })
  await expect(page.getByRole('listitem').filter({ hasText: 'ballade' })).toBeVisible({
    timeout: 60_000,
  })
})

// --- utilitaires -----------------------------------------------------------

/** Quota et occupation du stockage, en clair, pour les messages d'echec. */
async function estimate(page: Page): Promise<string> {
  const { quota, usage } = await page.evaluate(() => navigator.storage.estimate())
  const mo = (bytes: number | undefined) => `${((bytes ?? 0) / 1024 / 1024).toFixed(1)} Mo`
  return `${mo(usage)} occupes sur ${mo(quota)}`
}

async function waitForController(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 30_000,
    })
    .toBe(true)
}

/** Nombre de morceaux reellement presents dans le stockage local. */
async function storedTrackCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const namespace = await root.getDirectoryHandle('stemlab', { create: true })
    const tracks = await namespace
      .getDirectoryHandle('tracks', { create: true })
      .catch(() => null)
    if (!tracks) return 0

    let count = 0
    for await (const [, handle] of tracks.entries()) {
      if (handle.kind === 'directory') count += 1
    }
    return count
  })
}

/** Dimensions d'un PNG, lues dans son en-tete IHDR. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
