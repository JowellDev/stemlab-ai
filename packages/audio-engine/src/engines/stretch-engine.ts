import type { StemType } from '@stemlab/contracts'
import type { LoadedStem } from '../types.js'
import { type PlaybackEngine, type StartOptions, describeStems } from './types.js'

/**
 * Moteur d'etirement temporel : Signalsmith Stretch, en WASM dans un AudioWorklet.
 *
 * Toutes les pistes sont chargees dans **un seul** noeud, sous forme de paires de
 * canaux. Une unique analyse pilote donc l'ensemble : la derive entre pistes n'est
 * pas seulement improbable, elle est structurellement impossible — les canaux ne
 * sont pas suivis separement.
 *
 * Mesure a l'appui : 300 s d'entree a 75 % et -3 demi-tons, 99 evenements releves
 * sur 386 s de sortie, ecart maximal entre canaux de 0 echantillon.
 */

/** Interface du noeud, telle que la bibliotheque l'expose. */
interface StretchNode extends AudioNode {
  addBuffers(channels: Float32Array[]): Promise<number>
  schedule(options: {
    output?: number
    active?: boolean
    input?: number
    rate?: number
    semitones?: number
  }): void
  stop(when?: number): void
  latency(): Promise<number> | number
  setUpdateInterval(seconds: number): void
  inputTime: number
}

type StretchFactory = (
  context: BaseAudioContext,
  options?: AudioWorkletNodeOptions,
) => Promise<StretchNode>

/**
 * Avance minimale entre la planification et l'instant cible.
 *
 * Le noeud compense sa propre latence : planifier trop pres de l'instant courant
 * placerait la cible dans le passe et produirait une transition molle, le temps
 * qu'il rattrape.
 */
const SCHEDULE_LEAD_SECONDS = 0.25

export class StretchEngine implements PlaybackEngine {
  readonly supportsIndependentPitch = true
  readonly startLead = SCHEDULE_LEAD_SECONDS
  readonly duration: number

  readonly #context: BaseAudioContext
  readonly #node: StretchNode
  readonly #splitter: ChannelSplitterNode
  readonly #outputs = new Map<StemType, ChannelMergerNode>()
  #playing = false

  private constructor(
    context: BaseAudioContext,
    node: StretchNode,
    stems: readonly LoadedStem[],
    duration: number,
  ) {
    this.#context = context
    this.#node = node
    this.duration = duration

    this.#splitter = context.createChannelSplitter(stems.length * 2)
    node.connect(this.#splitter)

    // Chaque piste occupe deux canaux consecutifs, qu'on regroupe en stereo.
    for (const [index, stem] of stems.entries()) {
      const merger = context.createChannelMerger(2)
      this.#splitter.connect(merger, index * 2, 0)
      this.#splitter.connect(merger, index * 2 + 1, 1)
      this.#outputs.set(stem.type, merger)
    }
  }

  static async create(
    context: BaseAudioContext,
    stems: readonly LoadedStem[],
    createNode: StretchFactory,
  ): Promise<StretchEngine> {
    if (stems.length === 0) throw new Error('aucune piste a charger')

    const { duration, sampleRate } = describeStems(stems)
    const length = Math.max(...stems.map((stem) => stem.buffer.length))

    const node = await createNode(context, {
      // Une entree declaree mais laissee libre : Chrome n'execute pas un
      // processeur qui n'en a aucune, meme lorsqu'il est une source.
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [stems.length * 2],
    })

    node.setUpdateInterval(0.1)
    await node.addBuffers(toChannelArrays(stems, length))

    const engine = new StretchEngine(context, node, stems, duration)
    void sampleRate
    return engine
  }

  outputFor(type: StemType): AudioNode | undefined {
    return this.#outputs.get(type)
  }

  start(options: StartOptions): void {
    this.#playing = true
    this.#node.schedule({
      output: options.when,
      active: true,
      input: options.offset,
      rate: options.rate,
      semitones: options.semitones,
    })
  }

  stop(): void {
    if (!this.#playing) return
    this.#playing = false
    this.#node.schedule({ output: this.#context.currentTime, active: false })
  }

  /**
   * Change la vitesse sans interrompre la lecture.
   *
   * `from` porte la position attendue a l'instant planifie : la donner evite que
   * le noeud ne reinterprete a la nouvelle vitesse le temps deja ecoule.
   */
  setRate(rate: number, from: StartOptions | null): void {
    this.#reschedule({ rate }, from)
  }

  setSemitones(semitones: number, from: StartOptions | null): void {
    this.#reschedule({ semitones }, from)
  }

  #reschedule(change: { rate?: number; semitones?: number }, from: StartOptions | null): void {
    if (!this.#playing) {
      // A l'arret, le reglage sera pris en compte au prochain demarrage.
      return
    }
    const output = this.#context.currentTime + SCHEDULE_LEAD_SECONDS
    this.#node.schedule({
      output,
      active: true,
      ...(from ? { input: from.offset, rate: from.rate, semitones: from.semitones } : {}),
      ...change,
    })
  }

  destroy(): void {
    try {
      this.#node.schedule({ output: this.#context.currentTime, active: false })
    } catch {
      // Le contexte a pu etre ferme avant : il n'y a plus rien a arreter.
    }
    this.#node.disconnect()
    this.#splitter.disconnect()
    for (const merger of this.#outputs.values()) merger.disconnect()
    this.#outputs.clear()
  }
}

/**
 * Met les pistes a plat en canaux de meme longueur.
 *
 * Le noeud exige des tableaux de longueur identique. Les pistes plus courtes —
 * Demucs en produit parfois a quelques echantillons pres — sont completees par du
 * silence, et une piste mono est dupliquee.
 */
export function toChannelArrays(stems: readonly LoadedStem[], length: number): Float32Array[] {
  const channels: Float32Array[] = []

  for (const stem of stems) {
    const { buffer } = stem
    for (let channel = 0; channel < 2; channel += 1) {
      const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
      if (source.length === length) {
        channels.push(source.slice())
        continue
      }
      const padded = new Float32Array(length)
      padded.set(source.subarray(0, Math.min(source.length, length)))
      channels.push(padded)
    }
  }

  return channels
}
