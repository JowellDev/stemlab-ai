import { type Page, expect, test } from '@playwright/test'

/**
 * Verification du lecteur dans un vrai navigateur.
 *
 * Chromium est lance avec `--autoplay-policy=no-user-gesture-required` : sans cela
 * l'AudioContext reste suspendu et rien ne peut demarrer par script. Le
 * deverrouillage par geste utilisateur reste couvert par le code du moteur.
 */
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  },
})

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/player')
  await expect(page.getByRole('heading', { name: 'Grille de test — Am F C G' })).toBeVisible()
  // Les quatre stems doivent etre decodes avant que le transport soit utilisable.
  await expect(page.getByText('Pret', { exact: true })).toBeVisible({ timeout: 30_000 })
})

test('affiche une piste par stem', async ({ page }) => {
  for (const label of ['Voix', 'Batterie', 'Basse', 'Autres']) {
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }
})

test('la lecture avance et la pause fige la position', async ({ page }) => {
  await page.getByRole('button', { name: 'Lire' }).click()
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()

  await expect.poll(() => readPosition(page)).toBeGreaterThan(0.5)

  await page.getByRole('button', { name: 'Mettre en pause' }).click()
  await expect(page.getByText('En pause', { exact: true })).toBeVisible()

  // La position affichee se fige : elle est relue apres un delai franc pour que
  // toute avance residuelle se serait manifestee.
  await page.waitForTimeout(300)
  const paused = await readPosition(page)
  await page.waitForTimeout(700)
  expect(await readPosition(page)).toBe(paused)
})

test('la barre espace bascule lecture et pause', async ({ page }) => {
  await page.locator('body').press(' ')
  await expect(page.getByText('Lecture', { exact: true })).toBeVisible()
  await page.locator('body').press(' ')
  await expect(page.getByText('En pause', { exact: true })).toBeVisible()
})

test('les fleches deplacent la tete de lecture de cinq secondes', async ({ page }) => {
  // L'affichage est rafraichi par requestAnimationFrame : on interroge jusqu'a la
  // premiere frame suivant la frappe plutot que de lire immediatement.
  await page.locator('body').press('ArrowRight')
  await expect.poll(() => readPosition(page)).toBe(5)

  await page.locator('body').press('ArrowRight')
  await expect.poll(() => readPosition(page)).toBe(10)

  await page.locator('body').press('ArrowLeft')
  await expect.poll(() => readPosition(page)).toBe(5)

  // Borne basse : on ne repasse jamais avant le debut.
  await page.locator('body').press('ArrowLeft')
  await page.locator('body').press('ArrowLeft')
  await expect.poll(() => readPosition(page)).toBe(0)
})

test('Maj + fleche affine le pas a une seconde', async ({ page }) => {
  await page.locator('body').press('ArrowRight')
  await expect.poll(() => readPosition(page)).toBe(5)

  await page.locator('body').press('Shift+ArrowRight')
  await expect.poll(() => readPosition(page)).toBe(6)

  await page.locator('body').press('Shift+ArrowLeft')
  await expect.poll(() => readPosition(page)).toBe(5)
})

test('Origine revient au debut du morceau', async ({ page }) => {
  await page.locator('body').press('ArrowRight')
  await expect.poll(() => readPosition(page)).toBe(5)
  await page.locator('body').press('Home')
  await expect.poll(() => readPosition(page)).toBe(0)
})

test('M coupe la piste active et S la met en solo', async ({ page }) => {
  // La premiere piste (Voix) est active par defaut.
  await page.locator('body').press('m')
  await expect(page.getByRole('button', { name: 'Reactiver la piste Voix' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.locator('body').press('m')
  await expect(page.getByRole('button', { name: 'Couper la piste Voix' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await page.locator('body').press('s')
  await expect(
    page.getByRole('button', { name: 'Retirer le solo de la piste Voix' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.locator('body').press('Escape')
  await expect(page.getByRole('button', { name: 'Mettre en solo la piste Voix' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('les fleches haut et bas changent de piste active', async ({ page }) => {
  await page.locator('body').press('ArrowDown')
  await page.locator('body').press('m')
  await expect(page.getByRole('button', { name: 'Reactiver la piste Batterie' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('un clic dans la barre de transport deplace la lecture', async ({ page }) => {
  const bar = page.locator('div.relative.h-12.overflow-hidden').first()
  const box = await bar.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
  // 12 s de materiel : la moitie tombe vers 6 s, a la tolerance du clic pres.
  await expect.poll(() => readPosition(page)).toBeGreaterThan(5)
  await expect.poll(() => readPosition(page)).toBeLessThan(7)
})

/** Lit la position exposee par le moteur, pas le texte affiche. */
async function readPosition(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.querySelector('span.tabular-nums, p.tabular-nums span')
    const text = element?.textContent ?? '0:00.0'
    const [minutes, seconds] = text.split(':')
    return Number(minutes ?? 0) * 60 + Number(seconds ?? 0)
  })
}
