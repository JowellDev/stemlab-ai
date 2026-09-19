import type { StemType } from '@stemlab/contracts'
import { planStart } from '../scheduler.js'
import type { LoadedStem } from '../types.js'
import { type PlaybackEngine, type StartOptions, describeStems } from './types.js'

interface Channel {
  readonly type: StemType
  readonly buffer: AudioBuffer
  readonly output: GainNode
  source: AudioBufferSourceNode | null
}

/**
 * Moteur de repli : des `AudioBufferSourceNode` classiques.
 *
 * La vitesse passe par `playbackRate`, ce qui **deplace aussi la hauteur** : c'est
 * le comportement d'une bande magnetique. La transposition independante n'est donc
 * pas disponible. Ce moteur sert quand l'AudioWorklet ne peut pas etre charge —
 * navigateur trop ancien, politique de securite restrictive.
 */
export class BufferSourceEngine implements PlaybackEngine {
  readonly supportsIndependentPitch = false
  /** Une source classique demarre a l'instant demande, sans preparation. */
  readonly startLead = 0
  // Une source de tampon sort son audio a l'instant demande, sans traitement.
  readonly outputLatency = 0
  readonly duration: number

  readonly #context: BaseAudioContext
  readonly #channels = new Map<StemType, Channel>()
  #rate = 1

  constructor(context: BaseAudioContext, stems: readonly LoadedStem[]) {
    this.#context = context
    this.duration = describeStems(stems).duration

    for (const stem of stems) {
      const output = context.createGain()
      output.gain.value = 1
      this.#channels.set(stem.type, {
        type: stem.type,
        buffer: stem.buffer,
        output,
        source: null,
      })
    }
  }

  outputFor(type: StemType): AudioNode | undefined {
    return this.#channels.get(type)?.output
  }

  start(options: StartOptions): void {
    this.stop()
    this.#rate = options.rate

    const plan = planStart({
      stems: [...this.#channels.values()].map((channel) => ({
        type: channel.type,
        duration: channel.buffer.duration,
      })),
      // `planStart` ajoute son propre lookahead : on lui passe donc l'instant
      // cible diminue de celui-ci, pour respecter le `when` demande.
      contextTime: options.when,
      position: options.offset,
      duration: this.duration,
      lookahead: 0,
    })

    for (const scheduled of plan.sources) {
      const channel = this.#channels.get(scheduled.type)
      if (!channel) continue
      const source = this.#context.createBufferSource()
      source.buffer = channel.buffer
      source.playbackRate.value = options.rate
      source.connect(channel.output)
      // Instant identique pour toutes les pistes : c'est la garantie de synchro.
      source.start(scheduled.when, scheduled.offset)
      channel.source = source
    }
  }

  stop(): void {
    for (const channel of this.#channels.values()) {
      if (!channel.source) continue
      channel.source.onended = null
      try {
        channel.source.stop()
      } catch {
        // Une source jamais demarree leve ici : il n'y a rien a arreter.
      }
      channel.source.disconnect()
      channel.source = null
    }
  }

  setRate(rate: number, _from: StartOptions | null = null): void {
    this.#rate = rate
    for (const channel of this.#channels.values()) {
      if (channel.source) channel.source.playbackRate.value = rate
    }
  }

  setSemitones(_semitones: number, _from: StartOptions | null = null): void {
    // Sans traitement dedie, la hauteur suit la vitesse : il n'y a rien a regler.
  }

  get rate(): number {
    return this.#rate
  }

  destroy(): void {
    this.stop()
    for (const channel of this.#channels.values()) channel.output.disconnect()
    this.#channels.clear()
  }
}
