import type { StemType } from '@stemlab/contracts'
import type { LoadedStem } from '../types.js'

/**
 * Moteur de restitution.
 *
 * Le lecteur garde l'horloge, le transport et le mixage ; le moteur ne s'occupe
 * que de produire le son. Cette separation permet de remplacer la mecanique
 * d'etirement sans toucher a la logique de lecture — et de basculer sur un repli
 * quand l'AudioWorklet n'est pas disponible.
 */
export interface PlaybackEngine {
  /** Vrai quand tempo et hauteur sont pilotables independamment. */
  readonly supportsIndependentPitch: boolean

  /**
   * Avance minimale, en secondes, entre la planification et le demarrage effectif.
   *
   * Le lecteur ancre son horloge sur l'instant demande : si le moteur demarrait
   * plus tard que demande, la position afficherait un decalage permanent. Il
   * annonce donc ici son besoin, et le lecteur en tient compte.
   */
  readonly startLead: number

  /** Noeud de sortie d'une piste, stable pour toute la duree de vie du moteur. */
  outputFor(type: StemType): AudioNode | undefined

  /** Duree du materiel charge, en secondes. */
  readonly duration: number

  /**
   * Demarre la lecture.
   *
   * `when` est un instant absolu de l'AudioContext, partage par toutes les pistes :
   * c'est ce qui garantit qu'elles ne peuvent pas partir decalees.
   */
  start(options: StartOptions): void

  stop(): void

  setRate(rate: number, from: StartOptions | null): void

  setSemitones(semitones: number, from: StartOptions | null): void

  destroy(): void
}

export interface StartOptions {
  when: number
  /** Position dans le morceau, en secondes. */
  offset: number
  rate: number
  semitones: number
}

export interface EngineStems {
  readonly stems: readonly LoadedStem[]
  readonly duration: number
  readonly sampleRate: number
}

export function describeStems(stems: readonly LoadedStem[]): EngineStems {
  const duration = stems.reduce((max, stem) => Math.max(max, stem.buffer.duration), 0)
  const sampleRate = stems[0]?.buffer.sampleRate ?? 44_100
  return { stems, duration, sampleRate }
}
