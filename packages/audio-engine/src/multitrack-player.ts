import type { StemType } from '@stemlab/contracts'
import { createAudioContext, unlockOnFirstGesture } from './audio-context.js'
import { loadStems } from './decode.js'
import { PlayerEmitter } from './emitter.js'
import { type PlaybackEngine, createPlaybackEngine } from './engines/index.js'
import { anySoloed, clampVolume, resolveGain } from './mixer.js'
import { DEFAULT_LOOKAHEAD_SECONDS } from './scheduler.js'
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

/** Amplitude de transposition, en demi-tons. */
export const MIN_SEMITONES = -12
export const MAX_SEMITONES = 12

export interface MultitrackPlayerOptions {
  /** Contexte existant a reutiliser. Un contexte par page suffit et evite les
   *  limites de Safari sur le nombre d'AudioContext simultanes. */
  readonly context?: AudioContext
  readonly lookahead?: number
  readonly fetchImpl?: typeof fetch
  /** Fabrique de moteur, injectable pour les tests. */
  readonly createEngine?: typeof createPlaybackEngine
}

/**
 * Lecteur multipiste synchrone.
 *
 * Invariant central : toutes les pistes partagent un unique instant de demarrage.
 * Selon le moteur, cela se traduit par un `when` commun a toutes les sources, ou —
 * avec l'etirement temporel — par un unique noeud portant tous les canaux, ou la
 * derive est structurellement impossible.
 *
 * La position affichee est toujours derivee du `currentTime` de l'AudioContext, et
 * exprimee dans le **temps du morceau** : elle integre le facteur de vitesse, si
 * bien qu'un changement de tempo ne desaligne rien de ce qui en depend.
 */
export class MultitrackPlayer {
  readonly #emitter = new PlayerEmitter()
  readonly #context: AudioContext
  readonly #ownsContext: boolean
  readonly #master: GainNode
  readonly #lookahead: number
  readonly #fetchImpl: typeof fetch | undefined
  readonly #createEngine: typeof createPlaybackEngine

  #engine: PlaybackEngine | null = null
  #mixGains = new Map<StemType, GainNode>()
  #mix = new Map<StemType, StemMixState>()
  #clock: ClockState = IDLE_CLOCK
  #state: TransportState = 'idle'
  #duration = 0
  #masterVolume = 1
  #semitones = 0
  #endTimer: ReturnType<typeof setTimeout> | null = null
  #disposeUnlock: () => void
  #destroyed = false

  constructor(options: MultitrackPlayerOptions = {}) {
    this.#context = options.context ?? createAudioContext()
    this.#ownsContext = options.context === undefined
    this.#lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD_SECONDS
    this.#fetchImpl = options.fetchImpl
    this.#createEngine = options.createEngine ?? createPlaybackEngine
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

  /** Position courante, en secondes de morceau, derivee de l'horloge audio. */
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

  /** Transposition courante, en demi-tons. */
  get semitones(): number {
    return this.#semitones
  }

  /** Faux quand le moteur de repli est actif : la vitesse deplace alors la hauteur. */
  /**
   * Retard entre la position annoncee et le son entendu, en secondes.
   *
   * Le moteur d'etirement traite par blocs : sa sortie arrive apres coup. Tout
   * ce qui doit tomber *avec* le son — un metronome, un clic de repere — ajoute
   * ce retard a l'instant qu'il calcule depuis la position.
   */
  get outputLatency(): number {
    return this.#engine?.outputLatency ?? 0
  }

  get supportsIndependentPitch(): boolean {
    return this.#engine?.supportsIndependentPitch ?? false
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
      await this.#adoptStems(loaded)
      this.#setState('ready')
    } catch (error) {
      this.#setState('idle')
      const wrapped = error instanceof Error ? error : new Error(String(error))
      this.#emitter.emit({ type: 'error', error: wrapped })
      throw wrapped
    }
  }

  /** Variante sans reseau : utilisee par les tests et par la lecture hors-ligne. */
  async loadBuffers(stems: readonly LoadedStem[]): Promise<void> {
    this.#assertAlive()
    this.stop()
    await this.#adoptStems(stems)
    this.#setState('ready')
  }

  async #adoptStems(stems: readonly LoadedStem[]): Promise<void> {
    this.#releaseEngine()

    const engine = await this.#createEngine(this.#context, stems, {
      onFallback: (reason) => {
        // La lecture reste possible, mais sans transposition independante :
        // l'interface doit pouvoir le dire plutot que de laisser un reglage muet.
        this.#emitter.emit({ type: 'fallback', reason })
      },
    })

    const mix = new Map<StemType, StemMixState>()
    this.#mixGains = new Map()

    for (const stem of stems) {
      const output = engine.outputFor(stem.type)
      if (!output) continue

      const gain = this.#context.createGain()
      gain.gain.value = 1
      output.connect(gain)
      gain.connect(this.#master)

      this.#mixGains.set(stem.type, gain)
      mix.set(stem.type, {
        type: stem.type,
        volume: this.#mix.get(stem.type)?.volume ?? 1,
        muted: false,
        soloed: false,
      })
    }

    this.#engine = engine
    this.#mix = mix
    this.#duration = engine.duration
    this.#clock = pausedClock(0, this.#clock.rate)
    this.#applyGains()
    this.#emitMix()
  }

  // --- transport ------------------------------------------------------------

  async play(): Promise<void> {
    this.#assertAlive()
    if (!this.#engine || this.#mixGains.size === 0) return
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
    this.#stopEngine()
    this.#clock = pausedClock(position, this.#clock.rate)
    this.#setState('paused')
  }

  /**
   * Deplace la tete de lecture.
   *
   * En lecture, le moteur est arrete puis relance : c'est la seule facon de
   * garantir qu'aucune piste ne conserve l'ancien alignement.
   */
  seek(position: number): void {
    this.#assertAlive()
    const target = clamp(position, 0, this.#duration)
    if (this.#state === 'playing') {
      this.#stopEngine()
      this.#startAt(target)
      return
    }
    this.#clock = pausedClock(target, this.#clock.rate)
    if (this.#state === 'ended') this.#setState('paused')
  }

  stop(): void {
    if (this.#destroyed) return
    this.#stopEngine()
    this.#clock = pausedClock(0, this.#clock.rate)
    if (this.#state === 'playing' || this.#state === 'paused' || this.#state === 'ended') {
      this.#setState('ready')
    }
  }

  #startAt(position: number): void {
    const engine = this.#engine
    if (!engine) return

    if (position >= this.#duration) {
      this.#clock = pausedClock(this.#duration, this.#clock.rate)
      this.#setState('ended')
      this.#emitter.emit({ type: 'ended' })
      return
    }

    // L'avance retenue est celle dont le moteur a besoin : l'horloge est ancree
    // sur cet instant, et le son doit donc commencer exactement la.
    const lead = Math.max(this.#lookahead, engine.startLead)
    const when = this.#context.currentTime + lead

    engine.start({ when, offset: position, rate: this.#clock.rate, semitones: this.#semitones })

    this.#clock = startedClock(when, position, this.#clock.rate)
    this.#setState('playing')
    this.#scheduleEndCheck()
  }

  #stopEngine(): void {
    this.#clearEndTimer()
    this.#engine?.stop()
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
        this.#stopEngine()
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

  // --- tempo et hauteur -----------------------------------------------------

  /**
   * Change la vitesse de lecture.
   *
   * L'horloge est reancree sur la position courante au moment du changement :
   * sans cela, tout le temps deja ecoule serait reinterprete a la nouvelle
   * vitesse et la position afficherait un saut.
   */
  setPlaybackRate(rate: number): void {
    this.#assertAlive()
    const clamped = clampRange(rate, MIN_RATE, MAX_RATE, 1)
    if (clamped === this.#clock.rate) return

    const position = this.position
    const playing = this.#state === 'playing'

    this.#clock = playing
      ? startedClock(this.#context.currentTime, position, clamped)
      : pausedClock(position, clamped)

    this.#engine?.setRate(clamped, this.#currentStart(position, clamped))
    if (playing) this.#scheduleEndCheck()
  }

  /**
   * Transpose la lecture, sans toucher au tempo.
   *
   * Sans moteur d'etirement, le reglage est conserve mais reste sans effet sur le
   * son : `supportsIndependentPitch` permet a l'interface de le signaler.
   */
  setSemitones(semitones: number): void {
    this.#assertAlive()
    const clamped = clampRange(semitones, MIN_SEMITONES, MAX_SEMITONES, 0, true)
    if (clamped === this.#semitones) return

    this.#semitones = clamped
    this.#engine?.setSemitones(clamped, this.#currentStart(this.position, this.#clock.rate))
  }

  #currentStart(position: number, rate: number) {
    if (this.#state !== 'playing' || !this.#engine) return null
    const lead = Math.max(this.#lookahead, this.#engine.startLead)
    // Position attendue a l'instant ou le changement prendra effet.
    return {
      when: this.#context.currentTime + lead,
      offset: Math.min(position + lead * rate, this.#duration),
      rate,
      semitones: this.#semitones,
    }
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
      const gain = this.#mixGains.get(type)
      if (!gain) continue
      this.#ramp(gain.gain, resolveGain(stem, soloed))
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

  #releaseEngine(): void {
    this.#engine?.destroy()
    this.#engine = null
    for (const gain of this.#mixGains.values()) gain.disconnect()
    this.#mixGains.clear()
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('MultitrackPlayer deja detruit')
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#clearEndTimer()
    this.#releaseEngine()
    this.#master.disconnect()
    this.#disposeUnlock()
    this.#emitter.clear()
    this.#mix.clear()
    this.#destroyed = true
    if (this.#ownsContext) void this.#context.close().catch(() => {})
  }
}

function clampRange(
  value: number,
  min: number,
  max: number,
  fallback: number,
  round = false,
): number {
  if (!Number.isFinite(value)) return fallback
  const bounded = Math.min(max, Math.max(min, value))
  return round ? Math.round(bounded) : bounded
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}
