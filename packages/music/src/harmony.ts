import { type Accidental, accidentalForKey, normalizePitchClass, pitchClassName } from './spelling.js'

/**
 * Accords diatoniques et voicings.
 *
 * Ce module ne produit pas de son : il dit quelles notes former, et sous quel
 * nom les afficher. Le rendu sonore vit dans `@stemlab/audio-engine`, qui n'a
 * pas a connaitre la theorie.
 */

export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'sus2'
  | 'sus4'
  | 'maj7'
  | 'min7'
  | 'dom7'
  | 'min7b5'
  | 'add9'
  | 'maj9'
  | 'min9'
  | '7sus4'
  | '6'
  | 'min6'

/** Intervalles en demi-tons depuis la fondamentale. */
export const CHORD_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  min7b5: [0, 3, 6, 10],
  add9: [0, 4, 7, 14],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  '7sus4': [0, 5, 7, 10],
  '6': [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
}

/** Suffixe affiche apres le nom de la fondamentale. */
const SUFFIXES: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  min7b5: 'm7b5',
  add9: 'add9',
  maj9: 'maj9',
  min9: 'm9',
  '7sus4': '7sus4',
  '6': '6',
  min6: 'm6',
}

export type Mode = 'major' | 'minor'

/**
 * Fonction tonale, pour la couleur du pad.
 *
 * Trois familles plutot que sept degres : c'est ce qu'un musicien lit d'un coup
 * d'oeil — ou l'on est pose, ou l'on s'eloigne, ou l'on appelle la resolution.
 */
export type ChordFunction = 'tonic' | 'subdominant' | 'dominant' | 'colour'

export interface DiatonicChord {
  /** Classe de hauteur de la fondamentale, 0-11. */
  readonly root: number
  readonly quality: ChordQuality
  /** Libelle affiche, dans l'orthographe de l'armure. */
  readonly label: string
  /** Chiffrage romain : `I`, `vi`, `bVII`… */
  readonly degree: string
  readonly function: ChordFunction
}

interface Degree {
  /** Intervalle depuis la tonique, en demi-tons. */
  readonly interval: number
  readonly quality: ChordQuality
  readonly degree: string
  readonly function: ChordFunction
  /**
   * Orthographe imposee, quand la fonction l'emporte sur l'armure.
   *
   * Le `bVII` occupe la lettre du septieme degre abaisse : en do majeur il
   * s'ecrit `Bb`, jamais `A#`, alors meme que l'armure de do n'a aucun bemol.
   */
  readonly accidental?: Accidental
}

const MAJOR_DEGREES: readonly Degree[] = [
  { interval: 0, quality: 'maj', degree: 'I', function: 'tonic' },
  { interval: 2, quality: 'min', degree: 'ii', function: 'subdominant' },
  { interval: 4, quality: 'min', degree: 'iii', function: 'tonic' },
  { interval: 5, quality: 'maj', degree: 'IV', function: 'subdominant' },
  { interval: 7, quality: 'maj', degree: 'V', function: 'dominant' },
  { interval: 9, quality: 'min', degree: 'vi', function: 'tonic' },
  { interval: 11, quality: 'dim', degree: 'vii°', function: 'dominant' },
  // Emprunte au mode mixolydien. Omnipresent dans le repertoire de louange,
  // ou il remplace souvent le vii° — que personne ne joue.
  { interval: 10, quality: 'maj', degree: 'bVII', function: 'colour', accidental: 'flat' },
]

/**
 * Degres mineurs : mineur naturel, plus la dominante majeure.
 *
 * Le `v` naturel existe, mais c'est le `V` majeur — emprunte au mineur
 * harmonique — qui resout. Les deux sont proposes : le choix appartient au
 * musicien, pas au logiciel.
 */
const MINOR_DEGREES: readonly Degree[] = [
  { interval: 0, quality: 'min', degree: 'i', function: 'tonic' },
  { interval: 2, quality: 'dim', degree: 'ii°', function: 'subdominant' },
  { interval: 3, quality: 'maj', degree: 'III', function: 'tonic' },
  { interval: 5, quality: 'min', degree: 'iv', function: 'subdominant' },
  { interval: 7, quality: 'min', degree: 'v', function: 'dominant' },
  { interval: 8, quality: 'maj', degree: 'VI', function: 'colour' },
  { interval: 10, quality: 'maj', degree: 'VII', function: 'colour' },
  { interval: 7, quality: 'maj', degree: 'V', function: 'dominant' },
]

/**
 * Enrichissement applique a toute la grille.
 *
 * `triad` laisse chaque degre dans sa qualite naturelle ; les autres colorent
 * l'ensemble. Un enrichissement qui n'a pas de sens sur un degre — un `sus4` sur
 * un accord diminue — retombe sur la qualite naturelle plutot que de produire un
 * accord faux.
 */
export type ChordColour = 'triad' | 'sus2' | 'sus4' | 'seventh' | 'add9'

export function diatonicChords(
  keyRoot: number,
  mode: Mode,
  colour: ChordColour = 'triad',
): DiatonicChord[] {
  const accidental = accidentalForKey(keyRoot, mode)
  const degrees = mode === 'major' ? MAJOR_DEGREES : MINOR_DEGREES

  return degrees.map((entry) => {
    const root = normalizePitchClass(keyRoot + entry.interval)
    const quality = applyColour(entry.quality, colour)
    return {
      root,
      quality,
      label: chordLabel(root, quality, entry.accidental ?? accidental),
      degree: entry.degree,
      function: entry.function,
    }
  })
}

function applyColour(natural: ChordQuality, colour: ChordColour): ChordQuality {
  if (colour === 'triad') return natural

  // Un accord diminue perd son identite des qu'on lui retire la tierce ou qu'on
  // lui empile une neuvieme : on le laisse tel quel.
  if (natural === 'dim') return colour === 'seventh' ? 'min7b5' : natural

  switch (colour) {
    case 'sus2':
      return 'sus2'
    case 'sus4':
      return 'sus4'
    case 'add9':
      return natural === 'min' ? 'min9' : 'add9'
    case 'seventh':
      return natural === 'min' ? 'min7' : 'maj7'
  }
}

export function chordLabel(
  root: number,
  quality: ChordQuality,
  accidental: Accidental = 'sharp',
): string {
  return `${pitchClassName(root, accidental)}${SUFFIXES[quality]}`
}

/** Do central. Les numeros MIDI en dependent tous. */
export const MIDDLE_C = 60

export interface VoicingOptions {
  /** Octave de reference : 4 place la fondamentale autour du do central. */
  readonly octave?: number
  /**
   * Double la fondamentale une octave plus bas.
   *
   * C'est ce qui donne son assise a un pad : sans basse, l'accord flotte et se
   * confond avec le suivant pendant le fondu.
   */
  readonly bass?: boolean
  /**
   * Etale les notes au lieu de les empiler.
   *
   * Un accord serre dans le grave devient boueux — les partiels des notes
   * voisines battent entre eux. L'ecartement est ce qui rend un pad lisible.
   */
  readonly spread?: boolean
}

/**
 * Notes MIDI d'un accord.
 *
 * L'ecartement remonte une note sur deux d'une octave, en partant de la seconde :
 * la fondamentale et la quinte restent en bas, la tierce et les extensions
 * passent au-dessus. C'est le voicing le plus neutre qui sonne juste sur toutes
 * les qualites, sans avoir a traiter chaque cas.
 */
export function chordNotes(
  root: number,
  quality: ChordQuality,
  options: VoicingOptions = {},
): number[] {
  const octave = options.octave ?? 4
  const base = MIDDLE_C + normalizePitchClass(root) + (octave - 4) * 12

  const notes = CHORD_INTERVALS[quality].map((interval, index) => {
    const note = base + interval
    if (!options.spread) return note
    return index > 0 && index % 2 === 1 ? note + 12 : note
  })

  if (options.bass) notes.unshift(base - 12)

  return [...new Set(notes)].sort((a, b) => a - b)
}

/** Frequence d'une note MIDI, en hertz. La 440 est le la 4 (note 69). */
export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}
