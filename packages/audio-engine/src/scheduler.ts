import type { StemType } from '@stemlab/contracts'

/**
 * Planification du demarrage des pistes.
 *
 * Tout l'enjeu de la synchronisation tient ici : chaque `AudioBufferSourceNode` est
 * demarre avec le *meme* `when` absolu, calcule une fois a partir du `currentTime`
 * de l'AudioContext. Appeler `start()` sans argument, ou avec un `currentTime` relu
 * pour chaque piste, introduirait un decalage egal au temps d'execution de la boucle.
 */

/** Marge entre la planification et le demarrage effectif, en secondes. */
export const DEFAULT_LOOKAHEAD_SECONDS = 0.08

export interface SchedulableStem {
  readonly type: StemType
  /** Duree du buffer de cette piste. Les stems peuvent etre plus courts que le mix. */
  readonly duration: number
}

export interface ScheduledSource {
  readonly type: StemType
  /** Instant absolu de l'AudioContext ou la piste demarre. Identique pour toutes. */
  readonly when: number
  /** Position dans le buffer a laquelle commencer la lecture. */
  readonly offset: number
}

export interface StartPlan {
  /** Instant de demarrage commun a toutes les pistes. */
  readonly when: number
  /** Position du morceau correspondant a `when`. */
  readonly position: number
  readonly sources: readonly ScheduledSource[]
}

export interface PlanStartOptions {
  readonly stems: readonly SchedulableStem[]
  readonly contextTime: number
  readonly position: number
  readonly duration: number
  readonly lookahead?: number
}

/**
 * Construit le plan de demarrage. Une piste dont le buffer est plus court que la
 * position demandee est simplement omise : la planifier reviendrait a demarrer un
 * source node vide, que certains navigateurs signalent par une erreur.
 */
export function planStart(options: PlanStartOptions): StartPlan {
  const { stems, contextTime, duration } = options
  const lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD_SECONDS
  const position = clamp(options.position, 0, duration)
  const when = contextTime + lookahead

  if (position >= duration) {
    return { when, position, sources: [] }
  }

  const sources = stems
    .filter((stem) => position < stem.duration)
    .map((stem) => ({ type: stem.type, when, offset: position }))

  return { when, position, sources }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}
