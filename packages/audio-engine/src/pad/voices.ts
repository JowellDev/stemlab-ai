/**
 * Timbres du pad.
 *
 * Aucun echantillon n'est embarque, mais la synthese n'est pas naive pour
 * autant : ce qui fait qu'une nappe sonne, ce n'est pas le nombre d'harmoniques,
 * c'est le **mouvement**. Quatre choses le produisent, et chaque voix les dose :
 *
 * - l'**unisson** : plusieurs oscillateurs par note, legerement desaccordes et
 *   repartis dans l'espace. C'est de leurs battements que vient l'epaisseur ;
 * - la **derive** : chaque oscillateur d'unisson glisse lentement, de facon
 *   independante. Sans elle, l'unisson se fige et s'entend comme un choeur figé ;
 * - le **filtre en mouvement** : une oscillation tres lente du timbre. Un filtre
 *   immobile s'entend comme un echantillon tenu ;
 * - l'**ensemble** : des lignes a retard modulees, en opposition de phase entre
 *   les canaux. C'est ce qui elargit une nappe au-dela des enceintes.
 */

/** Couche d'oscillateurs : une strate du timbre. */
export interface Layer {
  /** Rapport a la frequence de la note. 0.5 = sous-octave, 2 = octave superieure. */
  readonly ratio: number
  readonly type: OscillatorType
  /** Gain relatif, avant normalisation. */
  readonly gain: number
  /** Nombre d'oscillateurs desaccordes. 1 = pas d'unisson. */
  readonly unison: number
  /** Ecart total de l'unisson, en centiemes. */
  readonly detune: number
  /** Largeur stereo de l'unisson, entre 0 et 1. */
  readonly spread: number
  /** Amplitude de la derive lente, en centiemes. */
  readonly drift?: number
  /** Retard d'entree, en secondes. Une strate qui arrive apres donne du relief. */
  readonly delay?: number
  /**
   * Strate envoyee a la seule reverberation, jamais au son direct.
   *
   * C'est ainsi qu'on obtient un scintillement : une octave superieure qui
   * n'existe que dans la queue de reverberation, jamais au premier plan. Les
   * vrais effets de « shimmer » transposent la reinjection ; sans transpositeur
   * temps reel, une strate dediee donne le meme resultat pour rien.
   */
  readonly reverbOnly?: boolean
}

export interface VoiceSpec {
  readonly id: string
  readonly name: string
  /** Une phrase : ce que la voix evoque, pas comment elle est faite. */
  readonly description: string
  readonly layers: readonly Layer[]

  readonly filter: {
    readonly type: BiquadFilterType
    /** Frequence de coupure au repos, en hertz. */
    readonly frequency: number
    readonly q: number
    /** Ouverture apportee par l'enveloppe, en octaves. */
    readonly envelope: number
    /** Oscillation lente du timbre : frequence en hertz, profondeur en octaves. */
    readonly lfoRate: number
    readonly lfoDepth: number
  }

  /** Lignes a retard modulees. `mix` a zero desactive l'etage. */
  readonly chorus: {
    readonly mix: number
    /** Retard de base, en secondes. */
    readonly delay: number
    readonly depth: number
    readonly rate: number
  }

  readonly attack: number
  readonly release: number
  /** Saturation douce, entre 0 et 1. Epaissit sans distordre. */
  readonly drive: number
  /** Souffle ajoute, entre 0 et 1. */
  readonly breath?: number

  readonly reverb: {
    readonly mix: number
    readonly seconds: number
    /** Retard avant la queue, en secondes : eloigne la salle sans noyer l'attaque. */
    readonly preDelay: number
    /** Attenuation progressive des aigus dans la queue, entre 0 et 1. */
    readonly damping: number
  }

  /**
   * Echo stereo alterne, reinjecte sur lui-meme.
   *
   * L'echo est ce qui met une nappe en mouvement dans la duree : la
   * reverberation remplit l'espace, le delai remplit le temps. Chaque repetition
   * passe par un passe-bas, donc s'assombrit — un echo qui garde ses aigus
   * s'entend comme une repetition, pas comme un lointain.
   */
  readonly delay: {
    readonly mix: number
    /** Intervalle entre deux repetitions, en secondes. */
    readonly time: number
    /** Part reinjectee, entre 0 et 1. Au-dela de 0,7, l'echo ne s'eteint plus. */
    readonly feedback: number
    /** Coupure du passe-bas dans la boucle, en hertz. */
    readonly damping: number
  }

  /**
   * Gain de sortie.
   *
   * Mesure par rendu hors-ligne sur un accord de quatre notes, pour que la
   * crete reste sous 0,8 : l'unisson, l'ensemble et la saturation ajoutent
   * chacun de l'energie, et une valeur choisie a vue ecrete.
   */
  readonly output: number
}

export const VOICES: readonly VoiceSpec[] = [
  {
    id: 'warm',
    name: 'Nappe chaude',
    description: 'Large, ronde, sans arete. Le point de depart.',
    layers: [
      { ratio: 1, type: 'sawtooth', gain: 1, unison: 5, detune: 16, spread: 0.9, drift: 5 },
      { ratio: 0.5, type: 'sine', gain: 0.6, unison: 1, detune: 0, spread: 0 },
      { ratio: 2, type: 'triangle', gain: 0.16, unison: 2, detune: 9, spread: 0.6, drift: 3 },
      // L'octave superieure ne vit que dans la reverberation : elle eclaire la
      // queue sans jamais s'imposer au premier plan.
      {
        ratio: 2,
        type: 'sine',
        gain: 0.3,
        unison: 3,
        detune: 12,
        spread: 1,
        drift: 6,
        delay: 1.6,
        reverbOnly: true,
      },
    ],
    filter: { type: 'lowpass', frequency: 1150, q: 1.0, envelope: 1.8, lfoRate: 0.06, lfoDepth: 0.55 },
    chorus: { mix: 0.5, delay: 0.022, depth: 0.0045, rate: 0.2 },
    attack: 2.6,
    release: 4.0,
    drive: 0.2,
    reverb: { mix: 0.55, seconds: 5.5, preDelay: 0.04, damping: 0.5 },
    delay: { mix: 0.24, time: 0.42, feedback: 0.42, damping: 2200 },
    output: 0.18,
  },
  {
    id: 'strings',
    name: 'Cordes',
    description: 'Un ensemble a cordes, ample et mouvant.',
    layers: [
      { ratio: 1, type: 'sawtooth', gain: 1, unison: 7, detune: 24, spread: 1, drift: 8 },
      { ratio: 2, type: 'sawtooth', gain: 0.26, unison: 3, detune: 14, spread: 0.8, drift: 6 },
      { ratio: 0.5, type: 'triangle', gain: 0.28, unison: 1, detune: 0, spread: 0 },
      {
        ratio: 2,
        type: 'triangle',
        gain: 0.26,
        unison: 3,
        detune: 16,
        spread: 1,
        drift: 7,
        delay: 2.0,
        reverbOnly: true,
      },
    ],
    filter: { type: 'lowpass', frequency: 2000, q: 0.8, envelope: 1.5, lfoRate: 0.09, lfoDepth: 0.4 },
    chorus: { mix: 0.6, delay: 0.018, depth: 0.0055, rate: 0.3 },
    attack: 2.2,
    release: 3.6,
    drive: 0.12,
    reverb: { mix: 0.58, seconds: 5.8, preDelay: 0.03, damping: 0.42 },
    delay: { mix: 0.2, time: 0.5, feedback: 0.38, damping: 2600 },
    output: 0.17,
  },
  {
    id: 'choir',
    name: 'Choeur',
    description: 'Des voix tenues, bouche fermee. Pour les moments suspendus.',
    layers: [
      { ratio: 1, type: 'triangle', gain: 1, unison: 6, detune: 15, spread: 0.95, drift: 11 },
      { ratio: 2, type: 'sine', gain: 0.38, unison: 3, detune: 10, spread: 0.7, drift: 7 },
      { ratio: 3, type: 'sine', gain: 0.1, unison: 2, detune: 8, spread: 0.5, drift: 5 },
      {
        ratio: 4,
        type: 'sine',
        gain: 0.18,
        unison: 2,
        detune: 10,
        spread: 1,
        drift: 6,
        delay: 2.4,
        reverbOnly: true,
      },
    ],
    // Un passe-bande a la hauteur d'une voyelle fermee : c'est ce qui fait
    // entendre « choeur » plutot que « nappe ».
    filter: { type: 'bandpass', frequency: 820, q: 1.5, envelope: 1.5, lfoRate: 0.11, lfoDepth: 0.45 },
    chorus: { mix: 0.7, delay: 0.026, depth: 0.006, rate: 0.24 },
    attack: 3.0,
    release: 4.4,
    drive: 0.08,
    breath: 0.1,
    reverb: { mix: 0.68, seconds: 6.5, preDelay: 0.05, damping: 0.55 },
    delay: { mix: 0.22, time: 0.62, feedback: 0.45, damping: 1800 },
    output: 0.33,
  },
  {
    id: 'glass',
    name: 'Verre',
    description: 'Clair et cristallin, presque immobile. Se pose au-dessus du reste.',
    layers: [
      { ratio: 1, type: 'sine', gain: 1, unison: 3, detune: 8, spread: 0.7, drift: 3 },
      { ratio: 2, type: 'sine', gain: 0.45, unison: 2, detune: 6, spread: 0.9, drift: 4 },
      { ratio: 3.01, type: 'sine', gain: 0.16, unison: 2, detune: 5, spread: 1, drift: 3 },
      {
        ratio: 4,
        type: 'sine',
        gain: 0.28,
        unison: 3,
        detune: 9,
        spread: 1,
        drift: 5,
        delay: 1.2,
        reverbOnly: true,
      },
    ],
    filter: { type: 'lowpass', frequency: 4200, q: 0.5, envelope: 1.0, lfoRate: 0.04, lfoDepth: 0.35 },
    chorus: { mix: 0.5, delay: 0.014, depth: 0.003, rate: 0.17 },
    attack: 2.4,
    release: 5.0,
    drive: 0,
    reverb: { mix: 0.72, seconds: 7.5, preDelay: 0.07, damping: 0.25 },
    delay: { mix: 0.3, time: 0.55, feedback: 0.5, damping: 4000 },
    output: 0.3,
  },
  {
    id: 'analog',
    name: 'Analogique',
    description: 'Un synthetiseur des annees quatre-vingt, epais et bombe.',
    layers: [
      { ratio: 1, type: 'sawtooth', gain: 1, unison: 5, detune: 20, spread: 0.85, drift: 9 },
      { ratio: 1, type: 'square', gain: 0.4, unison: 3, detune: 12, spread: 0.6, drift: 6 },
      { ratio: 0.5, type: 'square', gain: 0.35, unison: 1, detune: 0, spread: 0 },
    ],
    // Resonance marquee et balayage lent : la signature du genre.
    filter: { type: 'lowpass', frequency: 850, q: 5.5, envelope: 2.4, lfoRate: 0.07, lfoDepth: 1.0 },
    chorus: { mix: 0.55, delay: 0.02, depth: 0.005, rate: 0.28 },
    attack: 1.8,
    release: 3.0,
    drive: 0.4,
    reverb: { mix: 0.45, seconds: 4.2, preDelay: 0.025, damping: 0.6 },
    delay: { mix: 0.26, time: 0.36, feedback: 0.48, damping: 1600 },
    output: 0.1,
  },
  {
    id: 'shimmer',
    name: 'Scintillement',
    description: 'Une octave au-dessus qui s ouvre apres coup. Tres aere.',
    layers: [
      { ratio: 1, type: 'sawtooth', gain: 0.65, unison: 4, detune: 13, spread: 0.8, drift: 6 },
      { ratio: 0.5, type: 'sine', gain: 0.45, unison: 1, detune: 0, spread: 0 },
      {
        ratio: 2,
        type: 'sawtooth',
        gain: 0.5,
        unison: 4,
        detune: 18,
        spread: 1,
        drift: 8,
        delay: 1.4,
        reverbOnly: true,
      },
      {
        ratio: 4,
        type: 'sine',
        gain: 0.26,
        unison: 3,
        detune: 12,
        spread: 1,
        drift: 6,
        delay: 3.0,
        reverbOnly: true,
      },
    ],
    filter: { type: 'lowpass', frequency: 2800, q: 0.7, envelope: 2.0, lfoRate: 0.05, lfoDepth: 0.6 },
    chorus: { mix: 0.65, delay: 0.024, depth: 0.0065, rate: 0.18 },
    attack: 3.4,
    release: 6.0,
    drive: 0.15,
    reverb: { mix: 0.8, seconds: 8.5, preDelay: 0.08, damping: 0.3 },
    delay: { mix: 0.34, time: 0.68, feedback: 0.55, damping: 3200 },
    output: 0.12,
  },
  {
    id: 'air',
    name: 'Souffle',
    description: 'Presque rien : de l air, et un fond de note. Le silence habite.',
    layers: [
      { ratio: 1, type: 'sine', gain: 0.7, unison: 3, detune: 10, spread: 0.9, drift: 6 },
      { ratio: 2, type: 'sine', gain: 0.22, unison: 2, detune: 7, spread: 1, drift: 4 },
      {
        ratio: 3,
        type: 'sine',
        gain: 0.16,
        unison: 2,
        detune: 9,
        spread: 1,
        drift: 5,
        delay: 2.6,
        reverbOnly: true,
      },
    ],
    filter: { type: 'lowpass', frequency: 2200, q: 0.6, envelope: 1.2, lfoRate: 0.035, lfoDepth: 0.5 },
    chorus: { mix: 0.5, delay: 0.03, depth: 0.007, rate: 0.11 },
    attack: 4.0,
    release: 6.5,
    drive: 0,
    breath: 0.5,
    reverb: { mix: 0.85, seconds: 9.0, preDelay: 0.09, damping: 0.35 },
    delay: { mix: 0.3, time: 0.8, feedback: 0.5, damping: 2400 },
    output: 0.33,
  },
  {
    id: 'organ',
    name: 'Orgue',
    description: 'Des tirettes, franches et immediates. La seule voix sans attente.',
    layers: [
      { ratio: 1, type: 'sine', gain: 1, unison: 2, detune: 4, spread: 0.4 },
      { ratio: 2, type: 'sine', gain: 0.6, unison: 2, detune: 4, spread: 0.5 },
      { ratio: 3, type: 'sine', gain: 0.4, unison: 1, detune: 0, spread: 0.6 },
      { ratio: 4, type: 'sine', gain: 0.26, unison: 1, detune: 0, spread: 0.3 },
      { ratio: 6, type: 'sine', gain: 0.14, unison: 1, detune: 0, spread: 0.7 },
      { ratio: 8, type: 'sine', gain: 0.08, unison: 1, detune: 0, spread: 0.2 },
    ],
    filter: { type: 'lowpass', frequency: 4000, q: 0.6, envelope: 0.4, lfoRate: 0.02, lfoDepth: 0.12 },
    // Le rotatif d'un orgue est rapide : c'est ce qui le distingue d'un chorus.
    chorus: { mix: 0.45, delay: 0.008, depth: 0.0018, rate: 5.2 },
    attack: 0.1,
    release: 0.6,
    drive: 0.28,
    reverb: { mix: 0.38, seconds: 3.0, preDelay: 0.015, damping: 0.5 },
    delay: { mix: 0.1, time: 0.3, feedback: 0.25, damping: 1400 },
    output: 0.13,
  },
]

export function voiceById(id: string): VoiceSpec {
  return VOICES.find((voice) => voice.id === id) ?? VOICES[0]!
}
