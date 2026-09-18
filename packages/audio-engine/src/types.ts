import type { StemType } from '@stemlab/contracts'

export type TransportState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended'

/** Un stem a charger : son type et l'URL (presignee) de son fichier audio. */
export interface StemSource {
  readonly type: StemType
  readonly url: string
}

export interface LoadedStem {
  readonly type: StemType
  readonly buffer: AudioBuffer
}

/** Etat de mixage d'une piste. `volume` est un gain lineaire, pas des decibels. */
export interface StemMixState {
  readonly type: StemType
  readonly volume: number
  readonly muted: boolean
  readonly soloed: boolean
}

export interface PlayerSnapshot {
  readonly state: TransportState
  /** Position de lecture en secondes. Derivee de l'horloge audio, jamais du DOM. */
  readonly position: number
  readonly duration: number
  readonly masterVolume: number
  readonly stems: readonly StemMixState[]
}

export interface LoadProgress {
  readonly loaded: number
  readonly total: number
  readonly type: StemType
}

export type PlayerEvent =
  | { readonly type: 'statechange'; readonly state: TransportState }
  | { readonly type: 'mixchange'; readonly stems: readonly StemMixState[] }
  | { readonly type: 'loadprogress'; readonly progress: LoadProgress }
  | { readonly type: 'ended' }
  | { readonly type: 'error'; readonly error: Error }
  /** Le moteur d'etirement n'a pas pu etre charge : la lecture continue sans
   *  transposition independante. */
  | { readonly type: 'fallback'; readonly reason: Error }

export type PlayerEventType = PlayerEvent['type']

export type PlayerEventListener<T extends PlayerEventType = PlayerEventType> = (
  event: Extract<PlayerEvent, { type: T }>,
) => void
