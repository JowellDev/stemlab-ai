/**
 * Horloge de transport.
 *
 * La position de lecture est toujours derivee du `currentTime` de l'AudioContext,
 * jamais d'un compteur incremente par `requestAnimationFrame` : c'est la seule
 * horloge qui ne derive pas de celle des `AudioBufferSourceNode`, et donc la seule
 * qui reste alignee sur ce qu'on entend apres un seek ou une pause.
 */

export interface ClockState {
  /**
   * Instant de l'AudioContext auquel la lecture commence. `null` quand le transport
   * est arrete. Peut etre dans le futur pendant la fenetre de lookahead.
   */
  readonly startedAt: number | null
  /** Position dans le morceau correspondant a `startedAt`. */
  readonly offset: number
  /** Facteur de vitesse. 1 = tempo original. */
  readonly rate: number
}

export const IDLE_CLOCK: ClockState = { startedAt: null, offset: 0, rate: 1 }

export function startedClock(startedAt: number, offset: number, rate = 1): ClockState {
  return { startedAt, offset, rate }
}

export function pausedClock(position: number, rate = 1): ClockState {
  return { startedAt: null, offset: position, rate }
}

/**
 * Position de lecture a l'instant `contextTime`.
 *
 * Avant `startedAt` — c'est-a-dire pendant le lookahead qui separe la planification
 * du demarrage effectif — la position reste figee sur l'offset : l'affichage ne doit
 * pas avancer tant qu'aucun son n'est sorti.
 */
export function positionAt(clock: ClockState, contextTime: number, duration: number): number {
  if (clock.startedAt === null) return clamp(clock.offset, 0, duration)
  const elapsed = contextTime - clock.startedAt
  if (elapsed <= 0) return clamp(clock.offset, 0, duration)
  return clamp(clock.offset + elapsed * clock.rate, 0, duration)
}

/** `true` quand la lecture a atteint la fin du morceau. */
export function hasEnded(clock: ClockState, contextTime: number, duration: number): boolean {
  if (clock.startedAt === null) return false
  return positionAt(clock, contextTime, duration) >= duration
}

/**
 * Instant de l'AudioContext auquel une position donnee sera atteinte.
 * Renvoie `null` si le transport est arrete ou si la position est deja passee.
 */
export function contextTimeFor(clock: ClockState, position: number): number | null {
  if (clock.startedAt === null || clock.rate <= 0) return null
  const delta = (position - clock.offset) / clock.rate
  return delta < 0 ? null : clock.startedAt + delta
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}
