/**
 * Metronome cale sur les temps detectes.
 *
 * Il ne recalcule pas une grille a partir du tempo : il sonne sur les temps que
 * l'analyse a trouves dans l'enregistrement. Un morceau joue par des humains
 * respire — une grille reguliere derive au bout de quelques mesures, alors que
 * les temps detectes suivent l'interpretation.
 *
 * Les clics sont programmes a l'avance sur l'horloge audio, jamais declenches
 * par un minuteur : `setInterval` derive de plusieurs millisecondes, ce qui
 * s'entend immediatement sur une pulsation.
 */

export interface MetronomeBeat {
  /** Instant dans le morceau, en secondes, au tempo d'origine. */
  readonly time: number
  /** Rang du temps dans la mesure, a partir de 1. Le premier est accentue. */
  readonly position: number
}

export interface MetronomeOptions {
  readonly volume?: number
  /** Frequence du temps fort, en hertz. */
  readonly accentHz?: number
  /** Frequence des autres temps. */
  readonly beatHz?: number
}

/**
 * Avance de programmation, en secondes de temps reel.
 *
 * Assez pour absorber une interruption du fil principal, assez peu pour qu'un
 * deplacement de la tete de lecture ne laisse pas sonner des clics devenus faux.
 */
export const LOOKAHEAD_SECONDS = 0.35

/** Duree d'un clic. Au-dela, il devient une note ; en deca, il claque. */
const CLICK_SECONDS = 0.035

export class Metronome {
  readonly #context: AudioContext
  readonly #gain: GainNode
  readonly #accentHz: number
  readonly #beatHz: number

  #beats: readonly MetronomeBeat[] = []
  /** Index du prochain temps a programmer. */
  #next = 0
  /** Position source de la derniere programmation, pour detecter un saut. */
  #lastPosition = Number.NaN
  #scheduled: OscillatorNode[] = []
  #disposed = false

  constructor(context: AudioContext, options: MetronomeOptions = {}) {
    this.#context = context
    this.#accentHz = options.accentHz ?? 1600
    this.#beatHz = options.beatHz ?? 1000

    this.#gain = context.createGain()
    this.#gain.gain.value = options.volume ?? 0.35
    this.#gain.connect(context.destination)
  }

  get beats(): readonly MetronomeBeat[] {
    return this.#beats
  }

  setBeats(beats: readonly MetronomeBeat[]): void {
    // Tries une fois pour toutes : la programmation avance dans l'ordre, et un
    // tableau desordonne ferait sauter des temps.
    this.#beats = [...beats].sort((a, b) => a.time - b.time)
    this.reset()
  }

  setVolume(value: number): void {
    const now = this.#context.currentTime
    this.#gain.gain.cancelScheduledValues(now)
    this.#gain.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.02)
  }

  /**
   * Oublie ce qui a ete programme et repart de la position courante.
   *
   * Appele a chaque pause ou deplacement : les clics deja programmes portent des
   * instants qui ne correspondent plus a rien.
   */
  reset(): void {
    for (const node of this.#scheduled) safeStop(node)
    this.#scheduled = []
    this.#next = 0
    this.#lastPosition = Number.NaN
  }

  /**
   * Programme les clics de la fenetre a venir.
   *
   * `position` est en temps du morceau, `rate` le facteur de vitesse : a 75 %,
   * une seconde de morceau dure quatre tiers de seconde reelle, et l'ecart doit
   * etre converti avant d'etre confie a l'horloge audio.
   */
  schedule(position: number, rate: number, now = this.#context.currentTime): void {
    if (this.#disposed || this.#beats.length === 0 || rate <= 0) return

    // Un saut — vers l'avant comme vers l'arriere — invalide tout ce qui suit.
    if (!Number.isFinite(this.#lastPosition) || Math.abs(position - this.#lastPosition) > 0.5) {
      this.#rewindTo(position)
    }
    this.#lastPosition = position

    const horizon = position + LOOKAHEAD_SECONDS * rate

    while (this.#next < this.#beats.length) {
      const beat = this.#beats[this.#next]!
      if (beat.time > horizon) break

      // Un temps deja passe n'est pas rattrape : le faire sonner en retard est
      // pire que de le sauter.
      if (beat.time >= position) {
        this.#click(now + (beat.time - position) / rate, beat.position === 1)
      }
      this.#next += 1
    }

    this.#collect()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.reset()
    this.#gain.disconnect()
  }

  // --- interne -------------------------------------------------------------

  /** Replace le curseur de programmation au premier temps a venir. */
  #rewindTo(position: number): void {
    for (const node of this.#scheduled) safeStop(node)
    this.#scheduled = []

    let low = 0
    let high = this.#beats.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.#beats[middle]!.time < position) low = middle + 1
      else high = middle
    }
    this.#next = low
  }

  #click(when: number, accent: boolean): void {
    const context = this.#context

    const oscillator = context.createOscillator()
    oscillator.type = 'square'
    oscillator.frequency.value = accent ? this.#accentHz : this.#beatHz

    const envelope = context.createGain()
    // Attaque immediate, extinction exponentielle : c'est ce qui fait un clic
    // plutot qu'un bip.
    envelope.gain.setValueAtTime(accent ? 1 : 0.6, when)
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + CLICK_SECONDS)

    oscillator.connect(envelope)
    envelope.connect(this.#gain)
    oscillator.start(when)
    oscillator.stop(when + CLICK_SECONDS)

    this.#scheduled.push(oscillator)
  }

  /**
   * Oublie les clics deja joues.
   *
   * Ils s'arretent d'eux-memes ; la liste ne sert qu'a les interrompre lors d'un
   * deplacement. En garder seulement les derniers suffit, et evite qu'elle
   * grandisse sans fin sur un morceau long.
   */
  #collect(): void {
    if (this.#scheduled.length < 64) return
    this.#scheduled = this.#scheduled.slice(-16)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeStop(node: AudioScheduledSourceNode): void {
  try {
    node.stop()
  } catch {
    // Deja arrete ou jamais demarre : c'est le resultat attendu.
  }
  node.disconnect()
}
