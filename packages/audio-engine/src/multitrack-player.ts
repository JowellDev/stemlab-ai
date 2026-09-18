import type { StemType } from '@stemlab/contracts'
import { createAudioContext, unlockOnFirstGesture } from './audio-context.js'
import { loadStems } from './decode.js'
import { PlayerEmitter } from './emitter.js'
import { anySoloed, clampVolume, resolveGain } from './mixer.js'
import { DEFAULT_LOOKAHEAD_SECONDS, planStart } from './scheduler.js'
import {
  IDLE_CLOCK,
  type ClockState,
  pausedClock,
  positionAt,
  startedClock,
} from './transport-clock.js'
import type {
  LoadProgress,
  LoadedStem,
  PlayerEventListener,
  PlayerEventType,
  PlayerSnapshot,
  StemMixState,
  StemSource,
  TransportState,
} from './types.js'

/** Constante de temps des rampes de gain : assez courte pour rester reactive,
 *  assez longue pour qu'aucun changement de volume ne produise de clic. */
const GAIN_RAMP_SECONDS = 0.015

/** Bornes du facteur de vitesse exposees par l'interface. */
export const MIN_RATE = 0.5
export const MAX_RATE = 1.5

export interface MultitrackPlayerOptions {
  /** Contexte existant a reutiliser. Un contexte par page suffit et evite les
   *  limites de Safari sur le nombre d'AudioContext simultanes. */
  readonly context?: AudioContext
  readonly lookahead?: number
  readonly fetchImpl?: typeof fetch
}

interface StemChannel {
  readonly type: StemType
  readonly buffer: AudioBuffer
  readonly gain: GainNode
  source: AudioBufferSourceNode | null
}

/**
 * Lecteur multipiste synchrone.
 *
 * Invariant central : toutes les pistes partagent un unique instant de demarrage,
 * calcule une seule fois par `planStart`. Tout le reste — pause, seek, changement de
 * mix — se ramene a reconstruire ce plan. La position affichee est toujours derivee
 * du `currentTime` de l'AudioContext, jamais d'un compteur entretenu par l'UI.
 */
export class MultitrackPlayer {
  readonly #emitter = new PlayerEmitter()
  readonly #context: AudioContext
  readonly #ownsContext: boolean
  readonly #master: GainNode
  readonly #lookahead: number
  readonly #fetchImpl: typeof fetch | undefined

  #channels = new Map<StemType, StemChannel>()
  #mix = new Map<StemType, StemMixState>()
  #clock: ClockState = IDLE_CLOCK
  #state: TransportState = 'idle'
  #duration = 0
  #masterVolume = 1
  #endTimer: ReturnType<typeof setTimeout> | null = null
  #disposeUnlock: () => void
  #destroyed = false

  constructor(options: MultitrackPlayerOptions = {}) {
    this.#context = options.context ?? createAudioContext()
    this.#ownsContext = options.context === undefined
    this.#lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD_SECONDS
    this.#fetchImpl = options.fetchImpl
    this.#master = this.#context.createGain()
    this.#master.gain.value = 1
    this.#master.connect(this.#context.destination)
    this.#disposeUnlock = unlockOnFirstGesture(this.#context)
  }

  // --- lecture seule --------------------------------------------------------

  get context(): AudioContext {
    return this.#context
  }

  get state(): TransportState {
    return this.#state
  }

  get duration(): number {
    return this.#duration
  }

  /** Position courante, en secondes, derivee de l'horloge audio. */
  get position(): number {
    return positionAt(this.#clock, this.#context.currentTime, this.#duration)
  }

  get masterVolume(): number {
    return this.#masterVolume
  }

  /** Facteur de vitesse courant. 1 = tempo original. */
  get playbackRate(): number {
    return this.#clock.rate
  }

  snapshot(): PlayerSnapshot {
    return {
      state: this.#state,
      position: this.position,
      duration: this.#duration,
      masterVolume: this.#masterVolume,
      stems: [...this.#mix.values()],
    }
  }

  on<T extends PlayerEventType>(type: T, listener: PlayerEventListener<T>): () => void {
    return this.#emitter.on(type, listener)
  }

  // --- chargement -----------------------------------------------------------

  async load(
    sources: readonly StemSource[],
    options: { signal?: AbortSignal; onProgress?: (progress: LoadProgress) => void } = {},
  ): Promise<void> {
    this.#assertAlive()
    this.stop()
    this.#setState('loading')

    try {
      const loaded = await loadStems(this.#context, sources, {
        ...(options.signal ? { signal: options.signal } : {}),
        onProgress: (progress) => {
          options.onProgress?.(progress)
          this.#emitter.emit({ type: 'loadprogress', progress })
        },
        ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
      })
      this.#adoptStems(loaded)
      this.#setState('ready')
    } catch (error) {
      this.#setState('idle')
      const wrapped = error instanceof Error ? error : new Error(String(error))
      this.#emitter.emit({ type: 'error', error: wrapped })
      throw wrapped
    }
  }

  /** Variante sans reseau : utilisee par les tests et par la lecture hors-ligne. */
  loadBuffers(stems: readonly LoadedStem[]): void {
    this.#assertAlive()
    this.stop()
    this.#adoptStems(stems)
    this.#setState('ready')
  }

  #adoptStems(stems: readonly LoadedStem[]): void {
    this.#disconnectChannels()
    this.#channels = new Map()
    const mix = new Map<StemType, StemMixState>()

    for (const stem of stems) {
      const gain = this.#context.createGain()
      gain.gain.value = 1
      gain.connect(this.#master)
      this.#channels.set(stem.type, { type: stem.type, buffer: stem.buffer, gain, source: null })
      mix.set(stem.type, {
        type: stem.type,
        volume: this.#mix.get(stem.type)?.volume ?? 1,
        muted: false,
        soloed: false,
      })
    }

    this.#mix = mix
    // La duree du morceau est celle de la piste la plus longue : Demucs peut
    // produire des stems de longueurs tres legerement differentes.
    this.#duration = stems.reduce((max, stem) => Math.max(max, stem.buffer.duration), 0)
    this.#clock = pausedClock(0)
    this.#applyGains()
    this.#emitMix()
  }

  // --- transport ------------------------------------------------------------

  async play(): Promise<void> {
    this.#assertAlive()
    if (this.#channels.size === 0) return
    if (this.#state === 'playing') return

    if (this.#context.state === 'suspended') {
      await this.#context.resume()
    }

    // Rejouer depuis la fin repart du debut : c'est le comportement attendu d'un
    // bouton lecture sur un transport arrive au bout.
    const from = this.#state === 'ended' || this.position >= this.#duration ? 0 : this.position
    this.#startAt(from)
  }

  pause(): void {
    this.#assertAlive()
    if (this.#state !== 'playing') return
    const position = this.position
    this.#stopSources()
    this.#clock = pausedClock(position, this.#clock.rate)
    this.#setState('paused')
  }

  /**
   * Deplace la tete de lecture. En lecture, les sources sont detruites puis
   * replanifiees : c'est la seule facon de garantir qu'aucune piste ne conserve
   * l'ancien alignement.
   */
  seek(position: number): void {
    this.#assertAlive()
    const target = clamp(position, 0, this.#duration)
    if (this.#state === 'playing') {
      this.#stopSources()
      this.#startAt(target)
      return
    }
    this.#clock = pausedClock(target, this.#clock.rate)
    if (this.#state === 'ended') this.#setState('paused')
  }

  stop(): void {
    if (this.#destroyed) return
    this.#stopSources()
    this.#clock = pausedClock(0)
    if (this.#state === 'playing' || this.#state === 'paused' || this.#state === 'ended') {
      this.#setState('ready')
    }
  }

  /**
   * Change la vitesse de lecture.
   *
   * L'horloge est reancree sur la position courante au moment du changement :
   * sans cela, tout le temps deja ecoule serait reinterprete a la nouvelle
   * vitesse et la position afficherait un saut.
   *
   * Cette implementation modifie le `playbackRate` des sources, ce qui deplace
   * aussi la hauteur. La phase 6 remplace le mecanisme par un AudioWorklet
   * SoundTouch, qui dissocie les deux — l'API exposee ici ne change pas.
   */
  setPlaybackRate(rate: number): void {
    this.#assertAlive()
    const clamped = clampRate(rate)
    if (clamped === this.#clock.rate) return

    const position = this.position
    const playing = this.#state === 'playing'

    this.#clock = playing
      ? startedClock(this.#context.currentTime, position, clamped)
      : pausedClock(position, clamped)

    for (const channel of this.#channels.values()) {
      if (channel.source) channel.source.playbackRate.value = clamped
    }

    if (playing) this.#scheduleEndCheck()
  }

  #startAt(position: number): void {
    const plan = planStart({
      stems: [...this.#channels.values()].map((channel) => ({
        type: channel.type,
        duration: channel.buffer.duration,
      })),
      contextTime: this.#context.currentTime,
      position,
      duration: this.#duration,
      lookahead: this.#lookahead,
    })

    if (plan.sources.length === 0) {
      this.#clock = pausedClock(this.#duration, this.#clock.rate)
      this.#setState('ended')
      this.#emitter.emit({ type: 'ended' })
      return
    }

    for (const scheduled of plan.sources) {
      const channel = this.#channels.get(scheduled.type)
      if (!channel) continue
      const source = this.#context.createBufferSource()
      source.buffer = channel.buffer
      source.playbackRate.value = this.#clock.rate
      source.connect(channel.gain)
      // `when` est identique pour toutes les pistes : c'est ce qui garantit la synchro.
      source.start(scheduled.when, scheduled.offset)
      channel.source = source
    }

    this.#clock = startedClock(plan.when, plan.position, this.#clock.rate)
    this.#setState('playing')
    this.#scheduleEndCheck()
  }

  #stopSources(): void {
    this.#clearEndTimer()
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

  /**
   * La fin de lecture est detectee par une minuterie, mais *confirmee* par l'horloge
   * audio : `setTimeout` derive, `currentTime` non. Si la minuterie se reveille trop
   * tot, on la replanifie sur le temps restant reel.
   */
  #scheduleEndCheck(): void {
    this.#clearEndTimer()
    const remaining = (this.#duration - this.position) / (this.#clock.rate || 1)
    if (!Number.isFinite(remaining) || remaining <= 0) return

    this.#endTimer = setTimeout(
      () => {
        this.#endTimer = null
        if (this.#state !== 'playing') return
        if (this.position < this.#duration) {
          this.#scheduleEndCheck()
          return
        }
        this.#stopSources()
        this.#clock = pausedClock(this.#duration, this.#clock.rate)
        this.#setState('ended')
        this.#emitter.emit({ type: 'ended' })
      },
      Math.ceil(remaining * 1000) + 20,
    )
  }

  #clearEndTimer(): void {
    if (this.#endTimer === null) return
    clearTimeout(this.#endTimer)
    this.#endTimer = null
  }

  // --- mixage ---------------------------------------------------------------

  setVolume(type: StemType, volume: number): void {
    this.#updateMix(type, (stem) => ({ ...stem, volume: clampVolume(volume) }))
  }

  setMuted(type: StemType, muted: boolean): void {
    this.#updateMix(type, (stem) => ({ ...stem, muted }))
  }

  toggleMute(type: StemType): void {
    this.#updateMix(type, (stem) => ({ ...stem, muted: !stem.muted }))
  }

  setSoloed(type: StemType, soloed: boolean): void {
    this.#updateMix(type, (stem) => ({ ...stem, soloed }))
  }

  toggleSolo(type: StemType): void {
    this.#updateMix(type, (stem) => ({ ...stem, soloed: !stem.soloed }))
  }

  /** Coupe tous les solos d'un coup. */
  clearSolos(): void {
    let changed = false
    for (const [type, stem] of this.#mix) {
      if (!stem.soloed) continue
      this.#mix.set(type, { ...stem, soloed: false })
      changed = true
    }
    if (!changed) return
    this.#applyGains()
    this.#emitMix()
  }

  setMasterVolume(volume: number): void {
    this.#masterVolume = clampVolume(volume)
    this.#ramp(this.#master.gain, this.#masterVolume)
  }

  getStemState(type: StemType): StemMixState | undefined {
    return this.#mix.get(type)
  }

  #updateMix(type: StemType, update: (stem: StemMixState) => StemMixState): void {
    this.#assertAlive()
    const current = this.#mix.get(type)
    if (!current) return
    this.#mix.set(type, update(current))
    this.#applyGains()
    this.#emitMix()
  }

  #applyGains(): void {
    const soloed = anySoloed([...this.#mix.values()])
    for (const [type, stem] of this.#mix) {
      const channel = this.#channels.get(type)
      if (!channel) continue
      this.#ramp(channel.gain.gain, resolveGain(stem, soloed))
    }
  }

  /** Rampe exponentielle courte : evite le clic d'un changement de gain abrupt. */
  #ramp(param: AudioParam, value: number): void {
    const now = this.#context.currentTime
    param.cancelScheduledValues(now)
    param.setTargetAtTime(value, now, GAIN_RAMP_SECONDS)
  }

  #emitMix(): void {
    this.#emitter.emit({ type: 'mixchange', stems: [...this.#mix.values()] })
  }

  // --- cycle de vie ---------------------------------------------------------

  #setState(state: TransportState): void {
    if (this.#state === state) return
    this.#state = state
    this.#emitter.emit({ type: 'statechange', state })
  }

  #disconnectChannels(): void {
    for (const channel of this.#channels.values()) {
      channel.source?.disconnect()
      channel.gain.disconnect()
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('MultitrackPlayer deja detruit')
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#stopSources()
    this.#disconnectChannels()
    this.#master.disconnect()
    this.#disposeUnlock()
    this.#emitter.clear()
    this.#channels.clear()
    this.#mix.clear()
    this.#destroyed = true
    if (this.#ownsContext) void this.#context.close().catch(() => {})
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}
