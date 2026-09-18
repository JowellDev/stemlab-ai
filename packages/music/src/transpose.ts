import type { Chord } from '@stemlab/contracts'
import { accidentalForKey, normalizePitchClass, pitchClassName } from './spelling.js'

/**
 * Transposition des libelles.
 *
 * Quand l'utilisateur modifie la hauteur, les accords affiches doivent suivre :
 * lire `Am` en entendant `G#m` est pire que ne rien afficher. Rien n'est recalcule
 * a partir de l'audio — la fondamentale est deja connue, il suffit de la decaler.
 */

/** Amplitude de transposition proposee par l'interface, en demi-tons. */
export const MIN_SEMITONES = -12
export const MAX_SEMITONES = 12

export function clampSemitones(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(MIN_SEMITONES, Math.min(MAX_SEMITONES, Math.round(value)))
}

export interface TransposedKey {
  root: number
  name: string
  mode: 'major' | 'minor'
  /** Libelle complet, par exemple « La mineur ». */
  label: string
}

const MODE_LABELS = { major: 'majeur', minor: 'mineur' } as const

export function transposeKey(
  root: number,
  mode: 'major' | 'minor',
  semitones: number,
): TransposedKey {
  const transposed = normalizePitchClass(root + semitones)
  const name = pitchClassName(transposed, accidentalForKey(transposed, mode))
  return { root: transposed, name, mode, label: `${name} ${MODE_LABELS[mode]}` }
}

/**
 * Libelle d'un accord transpose.
 *
 * Un accord sans fondamentale — le silence, note « N » par le pipeline — n'est pas
 * transposable : il est rendu tel quel.
 */
export function transposeChordLabel(
  chord: Pick<Chord, 'root' | 'quality' | 'label'>,
  semitones: number,
  accidental: 'sharp' | 'flat' = 'sharp',
): string {
  if (chord.root === null) return chord.label
  const root = normalizePitchClass(chord.root + semitones)
  return `${pitchClassName(root, accidental)}${chord.quality}`
}

/** Transpose une suite d'accords, en conservant leurs bornes temporelles. */
export function transposeChords(
  chords: readonly Chord[],
  semitones: number,
  accidental: 'sharp' | 'flat' = 'sharp',
): Chord[] {
  if (semitones === 0 && accidental === 'sharp') return [...chords]
  return chords.map((chord) => ({
    ...chord,
    root: chord.root === null ? null : normalizePitchClass(chord.root + semitones),
    label: transposeChordLabel(chord, semitones, accidental),
  }))
}
