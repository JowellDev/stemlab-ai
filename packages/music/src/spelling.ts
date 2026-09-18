import { PITCH_CLASSES, type PitchClass } from '@stemlab/contracts'

/**
 * Orthographe des hauteurs : dieses ou bemols.
 *
 * Une meme touche du clavier s'ecrit `F#` ou `Gb` selon la tonalite. Afficher
 * systematiquement des dieses donne des grilles fausses a l'oeil d'un musicien —
 * un morceau en fa mineur s'ecrit avec des bemols, pas avec des `A#`.
 *
 * La regle appliquee est celle du cycle des quintes : on choisit l'orthographe de
 * l'armure de la tonalite courante.
 */

export type Accidental = 'sharp' | 'flat'

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

/**
 * Tonalites dont l'armure est en bemols.
 *
 * A six alterations, les deux orthographes sont equivalentes (fa diese majeur et
 * sol bemol majeur ont chacune six alterations). On tranche par l'usage : `F#`
 * majeur et `Ebm` mineur sont les graphies les plus repandues en musique populaire.
 */
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]) // F, Bb, Eb, Ab, Db

const FLAT_MINOR_KEYS = new Set([2, 7, 0, 5, 10, 3]) // Dm, Gm, Cm, Fm, Bbm, Ebm

export function accidentalForKey(root: number, mode: 'major' | 'minor'): Accidental {
  const pitchClass = normalizePitchClass(root)
  const flats = mode === 'major' ? FLAT_MAJOR_KEYS : FLAT_MINOR_KEYS
  return flats.has(pitchClass) ? 'flat' : 'sharp'
}

/** Nom d'une classe de hauteur, dans l'orthographe demandee. */
export function pitchClassName(root: number, accidental: Accidental = 'sharp'): string {
  const pitchClass = normalizePitchClass(root)
  return accidental === 'flat'
    ? (FLAT_NAMES[pitchClass] ?? 'C')
    : (PITCH_CLASSES[pitchClass] ?? 'C')
}

/** Index 0-11 d'un nom de hauteur, dieses et bemols acceptes. */
export function pitchClassIndex(name: string): number | null {
  const sharp = PITCH_CLASSES.indexOf(name as PitchClass)
  if (sharp !== -1) return sharp
  const flat = FLAT_NAMES.indexOf(name as (typeof FLAT_NAMES)[number])
  return flat === -1 ? null : flat
}

/** Ramene un entier quelconque dans [0, 11], y compris pour les valeurs negatives. */
export function normalizePitchClass(value: number): number {
  return ((Math.round(value) % 12) + 12) % 12
}
