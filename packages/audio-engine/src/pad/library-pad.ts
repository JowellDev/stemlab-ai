/**
 * Nappes jouees depuis des fichiers audio, une par tonalite.
 *
 * C'est le modele des bibliotheques de nappes du commerce : un enregistrement
 * par tonalite, tenu en boucle, et un fondu enchaine quand on change de
 * tonalite. Rien n'est synthetise — la valeur est dans l'enregistrement.
 *
 * Aucun effet n'est ajoute. Ces fichiers sortent d'un studio, reverberation
 * comprise : leur en superposer une seconde ne les ameliorerait pas, elle les
 * embrouillerait. Seule une securite de sortie est conservee.
 */

export interface LibraryPadOptions {
  readonly volume?: number
  /** Duree du fondu entre deux tonalites, en secondes. */
  readonly crossfade?: number
}

/** Fondu par defaut : assez long pour ne pas s'entendre, assez court pour suivre. */
export const DEFAULT_CROSSFADE = 3

export const MIN_CROSSFADE = 0.5
export const MAX_CROSSFADE = 12

interface Playing {
  readonly id: string
  readonly source: AudioBufferSourceNode
  readonly gain: GainNode
  /** Instant a partir duquel la source peut etre liberee. */
  endsAt: number
}

export class LibraryPad {
  readonly #context: AudioContext
  readonly #master: GainNode
  readonly #buffers = new Map<string, AudioBuffer>()

  #crossfade: number
  #playing: Playing[] = []
  #current: string | null = null
  #disposed = false

  constructor(context: AudioContext, options: LibraryPadOptions = {}) {
    this.#context = context
    this.#crossfade = clamp(options.crossfade ?? DEFAULT_CROSSFADE, MIN_CROSSFADE, MAX_CROSSFADE)

    // Meme securite que pour les autres sources : un fichier normalise trop fort,
    // superpose a un autre pendant le fondu, depasserait la pleine echelle.
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 4
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.2
    limiter.connect(context.destination)

    this.#master = context.createGain()
    this.#master.gain.value = options.volume ?? 0.8
    this.#master.connect(limiter)
  }

  /** Contexte audio, pour decoder les fichiers au bon taux d'echantillonnage. */
  get context(): AudioContext {
    return this.#context
  }

  /** Tonalite en cours, ou `null` quand le pad se tait. */
  get current(): string | null {
    return this.#current
  }

  /** Tonalites pour lesquelles un fichier est disponible. */
  get available(): string[] {
    return [...this.#buffers.keys()]
  }

  has(id: string): boolean {
    return this.#buffers.has(id)
  }

  /** Associe un enregistrement a une tonalite. Remplace le precedent, le cas echeant. */
  add(id: string, buffer: AudioBuffer): void {
    this.#buffers.set(id, buffer)
  }

  remove(id: string): void {
    this.#buffers.delete(id)
    if (this.#current === id) this.stop()
  }

  /**
   * Passe a la nappe d'une tonalite, en fondu depuis la precedente.
   *
   * Rejouer la tonalite en cours ne relance rien : la boucle continue. Une
   * tonalite sans fichier ne coupe pas ce qui sonne — mieux vaut garder la
   * nappe precedente que laisser un silence.
   */
  play(id: string): boolean {
    if (this.#disposed) return false
    if (this.#current === id) return true

    const buffer = this.#buffers.get(id)
    if (!buffer) return false

    const context = this.#context
    const now = context.currentTime

    this.#fadeOut(now)

    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(1, now + this.#crossfade)
    gain.connect(this.#master)

    const source = context.createBufferSource()
    source.buffer = buffer
    // Ces fichiers sont concus pour boucler : le point de bouclage est propre,
    // et une nappe qui s'arrete au bout de trente secondes n'en est pas une.
    source.loop = true
    source.connect(gain)
    source.start(now)

    this.#playing.push({ id, source, gain, endsAt: Number.POSITIVE_INFINITY })
    this.#current = id
    this.#collect(now)
    return true
  }

  stop(): void {
    this.#fadeOut(this.#context.currentTime)
    this.#current = null
  }

  setVolume(value: number): void {
    const now = this.#context.currentTime
    this.#master.gain.cancelScheduledValues(now)
    this.#master.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05)
  }

  setCrossfade(seconds: number): void {
    this.#crossfade = clamp(seconds, MIN_CROSSFADE, MAX_CROSSFADE)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true

    for (const entry of this.#playing) {
      safeStop(entry.source)
      entry.gain.disconnect()
    }
    this.#playing = []
    this.#buffers.clear()
    this.#current = null
    this.#master.disconnect()
  }

  #fadeOut(now: number): void {
    for (const entry of this.#playing) {
      if (entry.endsAt !== Number.POSITIVE_INFINITY) continue
      entry.gain.gain.cancelScheduledValues(now)
      entry.gain.gain.setValueAtTime(Math.max(entry.gain.gain.value, 0.0001), now)
      entry.gain.gain.exponentialRampToValueAtTime(0.0001, now + this.#crossfade)
      entry.endsAt = now + this.#crossfade
    }
  }

  /** Libere les nappes dont le fondu est termine. */
  #collect(now: number): void {
    this.#playing = this.#playing.filter((entry) => {
      if (entry.endsAt > now) return true
      safeStop(entry.source)
      entry.gain.disconnect()
      return false
    })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeStop(node: AudioScheduledSourceNode): void {
  try {
    node.stop()
  } catch {
    // Deja arretee : c'est le resultat attendu.
  }
  node.disconnect()
}
