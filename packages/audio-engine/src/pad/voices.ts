/**
 * Timbres du pad, decrits en donnees.
 *
 * Aucun echantillon n'est embarque : un pad de louange est fait de nappes
 * tenues, que la synthese additive rend tres bien. Cela evite plusieurs dizaines
 * de megaoctets d'echantillons a telecharger, et le pad reste jouable hors ligne
 * sans rien avoir prepare.
 *
 * Chaque voix est une liste de partiels. Un partiel est une onde a un rapport de
 * frequence donne, avec son propre gain et son propre desaccord — c'est le
 * desaccord, plus que la forme d'onde, qui donne son epaisseur a une nappe.
 */

export interface Partial {
  /** Rapport a la frequence de la note. 1 = fondamentale, 2 = octave. */
  readonly ratio: number
  readonly type: OscillatorType
  /** Gain relatif, avant normalisation. */
  readonly gain: number
  /** Desaccord en centiemes. Deux partiels identiques desaccordes battent — c'est voulu. */
  readonly detune?: number
}

export interface VoiceSpec {
  readonly id: string
  readonly name: string
  /** Une phrase, affichee sous le nom : ce que la voix evoque, pas comment elle est faite. */
  readonly description: string
  readonly partials: readonly Partial[]
  /** Passe-bas applique a l'ensemble. */
  readonly filter: { readonly frequency: number; readonly q: number }
  /**
   * Montee et descente, en secondes.
   *
   * Une attaque longue est ce qui distingue une nappe d'un orgue : le son
   * s'installe au lieu d'arriver. Une descente longue laisse l'accord precedent
   * se dissoudre dans le suivant.
   */
  readonly attack: number
  readonly release: number
  /** Profondeur du vibrato, en centiemes. Zero pour une nappe immobile. */
  readonly vibrato?: { readonly rate: number; readonly depth: number }
  /** Souffle ajoute, entre 0 et 1. Donne de l'air aux nappes les plus douces. */
  readonly breath?: number
  /** Part envoyee a la reverberation, entre 0 et 1. */
  readonly reverb: number
  /** Gain de sortie, pour egaliser les voix entre elles a l'oreille. */
  readonly output: number
}

export const VOICES: readonly VoiceSpec[] = [
  {
    id: 'warm',
    name: 'Nappe chaude',
    description: 'La nappe de fond, ronde et sans arete. Le point de depart.',
    partials: [
      { ratio: 1, type: 'sawtooth', gain: 1, detune: -7 },
      { ratio: 1, type: 'sawtooth', gain: 1, detune: 7 },
      { ratio: 2, type: 'sine', gain: 0.35 },
      { ratio: 0.5, type: 'sine', gain: 0.5 },
    ],
    filter: { frequency: 1400, q: 0.7 },
    attack: 1.6,
    release: 2.6,
    vibrato: { rate: 0.18, depth: 4 },
    reverb: 0.45,
    output: 0.32,
  },
  {
    id: 'strings',
    name: 'Cordes',
    description: 'Un ensemble a cordes, large et un peu mouvant.',
    partials: [
      { ratio: 1, type: 'sawtooth', gain: 1, detune: -11 },
      { ratio: 1, type: 'sawtooth', gain: 1, detune: 0 },
      { ratio: 1, type: 'sawtooth', gain: 1, detune: 11 },
      { ratio: 2, type: 'sawtooth', gain: 0.25, detune: 5 },
    ],
    filter: { frequency: 2400, q: 0.9 },
    attack: 1.1,
    release: 2.2,
    vibrato: { rate: 4.6, depth: 6 },
    reverb: 0.5,
    output: 0.24,
  },
  {
    id: 'choir',
    name: 'Choeur',
    description: 'Des voix tenues, bouche fermee. Pour les moments suspendus.',
    partials: [
      { ratio: 1, type: 'triangle', gain: 1, detune: -5 },
      { ratio: 1, type: 'triangle', gain: 1, detune: 5 },
      { ratio: 2, type: 'sine', gain: 0.45 },
      { ratio: 3, type: 'sine', gain: 0.18 },
      { ratio: 5, type: 'sine', gain: 0.07 },
    ],
    filter: { frequency: 1800, q: 2.2 },
    attack: 2.0,
    release: 3.0,
    vibrato: { rate: 5.2, depth: 8 },
    breath: 0.06,
    reverb: 0.6,
    output: 0.34,
  },
  {
    id: 'glass',
    name: 'Verre',
    description: 'Clair et cristallin, presque immobile. Se pose au-dessus du reste.',
    partials: [
      { ratio: 1, type: 'sine', gain: 1 },
      { ratio: 2, type: 'sine', gain: 0.5 },
      { ratio: 3, type: 'sine', gain: 0.22 },
      { ratio: 4.2, type: 'sine', gain: 0.12, detune: 4 },
      { ratio: 6, type: 'sine', gain: 0.06 },
    ],
    filter: { frequency: 5200, q: 0.5 },
    attack: 1.4,
    release: 3.4,
    reverb: 0.7,
    output: 0.3,
  },
  {
    id: 'analog',
    name: 'Analogique',
    description: 'Un synthetiseur des annees quatre-vingt, epais et un peu bombe.',
    partials: [
      { ratio: 1, type: 'square', gain: 0.8, detune: -9 },
      { ratio: 1, type: 'sawtooth', gain: 1, detune: 9 },
      { ratio: 0.5, type: 'square', gain: 0.4 },
    ],
    filter: { frequency: 1100, q: 4.5 },
    attack: 0.9,
    release: 1.8,
    vibrato: { rate: 0.12, depth: 10 },
    reverb: 0.35,
    output: 0.24,
  },
  {
    id: 'bells',
    name: 'Cloches',
    description: 'Des harmoniques inharmoniques, qui scintillent longtemps.',
    partials: [
      { ratio: 1, type: 'sine', gain: 1 },
      { ratio: 2.76, type: 'sine', gain: 0.3 },
      { ratio: 5.4, type: 'sine', gain: 0.14 },
      { ratio: 8.93, type: 'sine', gain: 0.06 },
    ],
    filter: { frequency: 6000, q: 0.4 },
    attack: 0.5,
    release: 4.5,
    reverb: 0.75,
    output: 0.26,
  },
  {
    id: 'air',
    name: 'Souffle',
    description: 'Presque rien : de l air, et un fond de note. Le silence habite.',
    partials: [
      { ratio: 1, type: 'sine', gain: 0.6 },
      { ratio: 2, type: 'sine', gain: 0.3 },
      { ratio: 4, type: 'sine', gain: 0.1 },
    ],
    filter: { frequency: 3200, q: 0.6 },
    attack: 2.8,
    release: 4.0,
    breath: 0.4,
    reverb: 0.8,
    output: 0.36,
  },
  {
    id: 'organ',
    name: 'Orgue',
    description: 'Des tirettes d orgue, franches et immediates.',
    partials: [
      { ratio: 1, type: 'sine', gain: 1 },
      { ratio: 2, type: 'sine', gain: 0.7 },
      { ratio: 3, type: 'sine', gain: 0.5 },
      { ratio: 4, type: 'sine', gain: 0.35 },
      { ratio: 6, type: 'sine', gain: 0.2 },
      { ratio: 8, type: 'sine', gain: 0.12 },
    ],
    filter: { frequency: 4200, q: 0.5 },
    attack: 0.12,
    release: 0.5,
    reverb: 0.3,
    output: 0.2,
  },
]

export function voiceById(id: string): VoiceSpec {
  return VOICES.find((voice) => voice.id === id) ?? VOICES[0]!
}
