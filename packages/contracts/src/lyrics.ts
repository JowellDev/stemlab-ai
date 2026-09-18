import { z } from 'zod'
import { Seconds } from './primitives.js'

/**
 * Paroles transcrites, et leurs traductions.
 *
 * Les horodatages sont au mot : c'est ce qui permet de suivre la ligne en cours
 * pendant la lecture, comme la grille d'accords. Un decoupage a la ligne seule
 * suffirait a afficher, pas a suivre.
 */

export const LyricWord = z.object({
  start: Seconds,
  end: Seconds,
  text: z.string().min(1).max(64),
})
export type LyricWord = z.infer<typeof LyricWord>

export const LyricLine = z.object({
  start: Seconds,
  end: Seconds,
  text: z.string().min(1).max(512),
  /** Vide quand le modele n'a pas su decouper la ligne. */
  words: z.array(LyricWord),
})
export type LyricLine = z.infer<typeof LyricLine>

/** Langues entre lesquelles la traduction est disponible. */
export const LyricsLanguage = z.enum(['fr', 'en'])
export type LyricsLanguage = z.infer<typeof LyricsLanguage>

export const Lyrics = z.object({
  /** Code ISO 639-1, ou `null` quand la detection n'est pas assez sure. */
  language: z.string().min(2).max(8).nullable(),
  languageConfidence: z.number().min(0).max(1),
  lines: z.array(LyricLine),
  /**
   * Par langue cible, une traduction par ligne, dans le meme ordre.
   *
   * L'alignement avec les horodatages tient entierement a cette correspondance
   * de position : une traduction par bloc, redecoupee ensuite, ne le garantirait
   * pas.
   */
  translations: z.record(z.string(), z.array(z.string())),
})
export type Lyrics = z.infer<typeof Lyrics>

/**
 * Langues affichables pour un morceau : l'originale et ses traductions.
 *
 * Utilitaire partage plutot que calcul cote interface — le serveur s'en sert
 * pour decider s'il y a quelque chose a proposer.
 */
export function availableLanguages(lyrics: Lyrics): string[] {
  const languages = new Set<string>()
  if (lyrics.language) languages.add(lyrics.language)
  for (const [code, lines] of Object.entries(lyrics.translations)) {
    if (lines.length === lyrics.lines.length) languages.add(code)
  }
  return [...languages]
}

/**
 * Ligne active a un instant donne.
 *
 * Renvoie l'index, ou `-1` avant la premiere ligne. Les silences entre lignes
 * conservent la ligne precedente : la faire disparaitre ferait clignoter
 * l'affichage a chaque respiration.
 */
export function lineAt(lines: readonly LyricLine[], time: number): number {
  let active = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.start > time) break
    active = i
  }
  return active
}

/** Mot actif dans une ligne, ou `-1` quand aucun ne couvre l'instant. */
export function wordAt(line: LyricLine, time: number): number {
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i]
    if (!word) continue
    if (time >= word.start && time < word.end) return i
  }
  return -1
}
