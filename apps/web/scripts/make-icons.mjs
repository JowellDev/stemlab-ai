/**
 * Genere les icones PNG de la PWA depuis leurs sources SVG.
 *
 * Aucun convertisseur SVG vers PNG n'est requis : on rend chaque icone dans le
 * Chromium deja installe pour les tests, ce qui garantit un resultat identique a
 * ce que verra le navigateur.
 *
 *   pnpm --filter @stemlab/web icons
 */
import { chromium } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

const browser = await chromium.launch()

try {
  const sources = readdirSync(ICONS_DIR).filter((name) => name.endsWith('.svg'))

  for (const name of sources) {
    const size = Number(name.match(/(\d+)\.svg$/)?.[1] ?? 512)
    const svg = readFileSync(join(ICONS_DIR, name), 'utf8')

    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    // `omitBackground` conserve la transparence hors du trace ; le fond plein des
    // icones vient du SVG lui-meme.
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg}</body>`,
      { waitUntil: 'load' },
    )

    const output = join(ICONS_DIR, name.replace(/\.svg$/, '.png'))
    await page.screenshot({ path: output, omitBackground: true })
    await page.close()

    console.log(`  ${name.padEnd(28)} -> ${size}x${size} px`)
  }
} finally {
  await browser.close()
}
