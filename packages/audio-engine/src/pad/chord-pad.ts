import { createReverb } from './reverb.js'
import { type VoiceSpec, voiceById } from './voices.js'

/**
 * Pad d'accords tenus, avec fondu enchaine.
 *
 * Le principe d'une nappe est la continuite : passer d'un accord au suivant ne
 * doit jamais laisser de trou. Chaque accord vit donc dans son propre groupe
 * d'oscillateurs, et jouer un accord lance le suivant pendant que le precedent
 * s'eteint — les deux se recouvrent, comme deux mains sur un clavier.
 *
 * C'est aussi pourquoi rien n'est reutilise d'un accord a l'autre : reconfigurer
 * des oscillateurs en cours de route produirait un glissando, pas un fondu.
 */

export interface ChordPadOptions {
  readonly voice?: string
  /** Gain general, entre 0 et 1. */
  readonly volume?: number
  /** Multiplie l'attaque et la descente de la voix. */
  readonly smoothness?: number
}

/** Un accord en cours de vie : ses oscillateurs et son enveloppe. */
interface Layer {
  readonly gain: GainNode
  readonly nodes: readonly AudioScheduledSourceNode[]
  /** Instant a partir duquel les noeuds peuvent etre liberes. */
  stopsAt: number
}

export const MIN_SMOOTHNESS = 0.4
export const MAX_SMOOTHNESS = 2.5

export class ChordPad {
  readonly #context: AudioContext
  readonly #dry: GainNode
  readonly #wet: GainNode
  readonly #master: GainNode
  readonly #reverb: ConvolverNode

  #voice: VoiceSpec
  #smoothness: number
  #layers: Layer[] = []
  #notes: readonly number[] = []
  #disposed = false

  constructor(context: AudioContext, options: ChordPadOptions = {}) {
    this.#context = context
    this.#voice = voiceById(options.voice ?? 'warm')
    this.#smoothness = clamp(options.smoothness ?? 1, MIN_SMOOTHNESS, MAX_SMOOTHNESS)

    this.#master = context.createGain()
    this.#master.gain.value = options.volume ?? 0.7
    this.#master.connect(context.destination)

    this.#dry = context.createGain()
    this.#dry.connect(this.#master)

    this.#reverb = createReverb(context)
    this.#wet = context.createGain()
    this.#wet.connect(this.#reverb)
    this.#reverb.connect(this.#master)

    this.#applyMix()
  }

  /** Notes MIDI actuellement tenues. Vide quand le pad se tait. */
  get notes(): readonly number[] {
    return this.#notes
  }

  get voice(): VoiceSpec {
    return this.#voice
  }

  /**
   * Tient un accord, en fondu depuis le precedent.
   *
   * Rejouer exactement le meme accord ne redeclenche rien : sur un pad, appuyer
   * deux fois sur le meme bouton ne doit pas produire de battement.
   */
  play(notes: readonly number[]): void {
    if (this.#disposed || notes.length === 0) return
    if (sameNotes(this.#notes, notes)) return

    this.#release()
    this.#layers.push(this.#buildLayer(notes))
    this.#notes = [...notes]
    this.#collect()
  }

  /** Laisse l'accord s'eteindre. La descente de la voix s'applique. */
  stop(): void {
    this.#release()
    this.#notes = []
  }

  setVoice(id: string): void {
    const next = voiceById(id)
    if (next.id === this.#voice.id) return
    this.#voice = next
    this.#applyMix()

    // Le changement s'entend tout de suite : l'accord en cours est rejoue avec
    // le nouveau timbre, en fondu. Attendre l'accord suivant donnerait
    // l'impression que le bouton n'a rien fait.
    if (this.#notes.length > 0) {
      const notes = this.#notes
      this.#notes = []
      this.play(notes)
    }
  }

  setVolume(value: number): void {
    const now = this.#context.currentTime
    this.#master.gain.cancelScheduledValues(now)
    this.#master.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05)
  }

  /** Allonge ou raccourcit l'attaque et la descente, sans changer de timbre. */
  setSmoothness(value: number): void {
    this.#smoothness = clamp(value, MIN_SMOOTHNESS, MAX_SMOOTHNESS)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true

    for (const layer of this.#layers) {
      for (const node of layer.nodes) safeStop(node)
      layer.gain.disconnect()
    }
    this.#layers = []
    this.#notes = []
    this.#master.disconnect()
    this.#dry.disconnect()
    this.#wet.disconnect()
    this.#reverb.disconnect()
  }

  // --- interne -------------------------------------------------------------

  #applyMix(): void {
    const now = this.#context.currentTime
    this.#wet.gain.setTargetAtTime(this.#voice.reverb, now, 0.08)
    this.#dry.gain.setTargetAtTime(1 - this.#voice.reverb * 0.4, now, 0.08)
  }

  #buildLayer(notes: readonly number[]): Layer {
    const context = this.#context
    const voice = this.#voice
    const now = context.currentTime
    const attack = voice.attack * this.#smoothness

    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    // Une montee exponentielle : l'oreille percoit le volume en decibels, et une
    // rampe lineaire s'entend comme une arrivee brutale suivie d'un plateau.
    gain.gain.exponentialRampToValueAtTime(voice.output, now + attack)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = voice.filter.frequency
    filter.Q.value = voice.filter.q

    // Le filtre s'ouvre avec l'attaque : une nappe qui s'eclaircit en montant
    // sonne vivante, une nappe a timbre fixe sonne comme un echantillon tenu.
    filter.frequency.setValueAtTime(voice.filter.frequency * 0.45, now)
    filter.frequency.linearRampToValueAtTime(voice.filter.frequency, now + attack)

    filter.connect(gain)
    gain.connect(this.#dry)
    gain.connect(this.#wet)

    const nodes: AudioScheduledSourceNode[] = []
    const vibrato = voice.vibrato ? this.#buildVibrato(voice.vibrato, now) : null
    if (vibrato) nodes.push(vibrato.oscillator)

    const weight = totalWeight(voice) * Math.sqrt(notes.length)

    for (const note of notes) {
      const frequency = midiToFrequency(note)

      for (const partial of voice.partials) {
        const oscillator = context.createOscillator()
        oscillator.type = partial.type
        oscillator.frequency.value = frequency * partial.ratio
        if (partial.detune) oscillator.detune.value = partial.detune
        vibrato?.depth.connect(oscillator.detune)

        const level = context.createGain()
        level.gain.value = partial.gain / weight

        oscillator.connect(level)
        level.connect(filter)
        oscillator.start(now)
        nodes.push(oscillator)
      }
    }

    if (voice.breath) {
      const noise = this.#buildBreath(voice.breath / Math.sqrt(notes.length), filter, now)
      nodes.push(noise)
    }

    return { gain, nodes, stopsAt: Number.POSITIVE_INFINITY }
  }

  #buildVibrato(
    vibrato: NonNullable<VoiceSpec['vibrato']>,
    now: number,
  ): { oscillator: OscillatorNode; depth: GainNode } {
    const oscillator = this.#context.createOscillator()
    oscillator.frequency.value = vibrato.rate
    const depth = this.#context.createGain()
    depth.gain.value = vibrato.depth
    oscillator.connect(depth)
    oscillator.start(now)
    return { oscillator, depth }
  }

  #buildBreath(amount: number, destination: AudioNode, now: number): AudioBufferSourceNode {
    const context = this.#context
    // Deux secondes de bruit bouclees : assez long pour que la boucle ne
    // s'entende pas, assez court pour ne rien couter en memoire.
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const level = context.createGain()
    level.gain.value = amount * 0.05

    source.connect(level)
    level.connect(destination)
    source.start(now)
    return source
  }

  /** Fait descendre tous les calques en cours, sans les detruire tout de suite. */
  #release(): void {
    const now = this.#context.currentTime
    const release = this.#voice.release * this.#smoothness

    for (const layer of this.#layers) {
      if (layer.stopsAt !== Number.POSITIVE_INFINITY) continue
      layer.gain.gain.cancelScheduledValues(now)
      layer.gain.gain.setValueAtTime(Math.max(layer.gain.gain.value, 0.0001), now)
      layer.gain.gain.exponentialRampToValueAtTime(0.0001, now + release)
      layer.stopsAt = now + release
    }
  }

  /**
   * Libere les calques dont la descente est terminee.
   *
   * Appele a chaque accord plutot que par un minuteur : tant que personne ne
   * joue, il n'y a rien a nettoyer, et un minuteur tournerait pour rien.
   */
  #collect(): void {
    const now = this.#context.currentTime
    this.#layers = this.#layers.filter((layer) => {
      if (layer.stopsAt > now) return true
      for (const node of layer.nodes) safeStop(node)
      layer.gain.disconnect()
      return false
    })
  }
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function totalWeight(voice: VoiceSpec): number {
  return voice.partials.reduce((sum, partial) => sum + partial.gain, 0)
}

function sameNotes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index])
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeStop(node: AudioScheduledSourceNode): void {
  try {
    node.stop()
  } catch {
    // Deja arrete : c'est le resultat attendu.
  }
  node.disconnect()
}
