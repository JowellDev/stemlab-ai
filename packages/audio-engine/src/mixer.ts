import type { StemType } from '@stemlab/contracts'
import type { StemMixState } from './types.js'

/**
 * Le solo est exclusif au niveau du mix : des qu'une piste au moins est en solo,
 * toutes les autres sont muettes, que leur propre `muted` soit vrai ou non. Une
 * piste en solo *et* coupee reste coupee : l'action explicite de l'utilisateur sur
 * cette piste l'emporte.
 */
export function resolveGain(stem: StemMixState, anySoloed: boolean): number {
  if (stem.muted) return 0
  if (anySoloed && !stem.soloed) return 0
  return clampVolume(stem.volume)
}

export function anySoloed(stems: readonly StemMixState[]): boolean {
  return stems.some((stem) => stem.soloed)
}

/** Gains effectifs de toutes les pistes, solo et mute resolus. */
export function resolveGains(stems: readonly StemMixState[]): Map<StemType, number> {
  const soloed = anySoloed(stems)
  return new Map(stems.map((stem) => [stem.type, resolveGain(stem, soloed)]))
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0
  if (volume < 0) return 0
  if (volume > 1) return 1
  return volume
}
