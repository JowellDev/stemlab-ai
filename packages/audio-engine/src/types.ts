import type { StemType } from '@stemlab/contracts'

/** Etat d'une piste au sein du lecteur multipiste. */
export interface StemState {
  readonly type: StemType
  volume: number
  muted: boolean
  soloed: boolean
}

export type TransportState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended'
