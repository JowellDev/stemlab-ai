#!/usr/bin/env node
/**
 * Telecharge la banque d'echantillons du pad.
 *
 * Elle n'est pas versionnee : vingt-quatre megaoctets dans l'historique Git
 * penaliseraient chaque clone, pour un fichier qui ne change jamais. Le depot
 * garde son adresse et sa licence ; le fichier, lui, se recupere a la demande.
 *
 * Elle n'est pas non plus precachee par le service worker : le pad synthetise
 * reste le mode par defaut, et fonctionne sans rien telecharger. La banque n'est
 * chargee que si l'on demande une voix echantillonnee, puis conservee dans le
 * stockage local du navigateur.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'

/**
 * FluidR3 Mono, en SoundFont 3 (echantillons compresses en Vorbis).
 *
 * Licence MIT — Frank Wen, conversion mono par Michael Cowgill, adaptation par
 * S. Christian Collins. Distribuee par le depot de MuseScore.
 */
const SOURCE =
  'https://raw.githubusercontent.com/musescore/MuseScore/main/share/sound/FluidR3Mono_GM.sf3'

const TARGET_DIR = join(import.meta.dirname, '../apps/web/public/soundfonts')
const TARGET = join(TARGET_DIR, 'FluidR3Mono_GM.sf3')

/** En deca, le fichier recu n'est pas la banque : page d'erreur, ou pointeur. */
const MIN_BYTES = 20 * 1024 * 1024

if (existsSync(TARGET) && statSync(TARGET).size >= MIN_BYTES) {
  console.log(`Banque deja presente (${(statSync(TARGET).size / 1e6).toFixed(1)} Mo).`)
  process.exit(0)
}

mkdirSync(TARGET_DIR, { recursive: true })
console.log('Telechargement de la banque…')

const response = await fetch(SOURCE)
if (!response.ok || !response.body) {
  console.error(`Telechargement impossible : HTTP ${response.status}`)
  process.exit(1)
}

await pipeline(Readable.fromWeb(response.body), createWriteStream(TARGET))

const size = statSync(TARGET).size
if (size < MIN_BYTES) {
  console.error(
    `Le fichier recu ne fait que ${(size / 1e6).toFixed(1)} Mo : ce n'est pas la banque.`,
  )
  process.exit(1)
}

console.log(`Banque ecrite dans apps/web/public/soundfonts (${(size / 1e6).toFixed(1)} Mo).`)
