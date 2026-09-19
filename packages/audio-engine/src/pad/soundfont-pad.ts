import { PadEffects } from './effects.js'
import { type VoiceSpec, voiceById } from './voices.js'

/**
 * Pad joue par une banque d'echantillons SoundFont.
 *
 * Meme surface que `ChordPad`, et surtout **la meme chaine d'effets** : ce qui
 * transforme une nappe, ce sont la reverberation et l'echo, pas la source. Les
 * echantillons apportent le grain d'un instrument reel ; le reste est commun.
 *
 * Le synthetiseur est `spessasynth` (Apache-2.0) plutot que FluidSynth : celui-ci
 * est en LGPL, licence dont l'exigence de relien n'a pas de sens pour un module
 * empaquete dans un bundle navigateur. C'est la meme raison qui avait fait
 * ecarter SoundTouch au profit de signalsmith-stretch.
 */

/** Ce que `spessasynth_lib` expose et dont on se sert. */
export interface SoundFontSynthesizer {
  readonly isReady: Promise<unknown>
  readonly soundBankManager: { addSoundBank(bank: ArrayBuffer, id: string): Promise<void> }
  connect(destination: AudioNode): AudioNode
  disconnect(destination?: AudioNode): AudioNode | undefined
  programChange(channel: number, program: number): void
  noteOn(channel: number, note: number, velocity: number): void
  noteOff(channel: number, note: number): void
  controllerChange?(channel: number, controller: number, value: number): void
}

export interface SoundFontPadOptions {
  /** Timbre dont on emprunte la salle, l'echo et les temps de fondu. */
  readonly voice?: string
  readonly volume?: number
  readonly smoothness?: number
  /** Programme General MIDI, de 0 a 127. */
  readonly program?: number
}

/** Canal MIDI unique : un pad ne joue qu'une chose a la fois. */
const CHANNEL = 0

/** Velocite fixe. Un pad se tient ; il ne se frappe pas. */
const VELOCITY = 96

export class SoundFontPad {
  readonly #context: AudioContext
  readonly #synth: SoundFontSynthesizer
  readonly #effects: PadEffects

  #voice: VoiceSpec
  #program: number
  #notes: number[] = []
  #disposed = false

  constructor(
    context: AudioContext,
    synth: SoundFontSynthesizer,
    options: SoundFontPadOptions = {},
  ) {
    this.#context = context
    this.#synth = synth
    this.#voice = voiceById(options.voice ?? 'warm')
    this.#program = options.program ?? 89
    this.#effects = new PadEffects(context, this.#voice, options.volume ?? 0.7)

    // Les trois entrees recoivent le meme signal : le synthetiseur ne connait
    // pas la chaine, il se contente de sonner.
    synth.connect(this.#effects.input)
    synth.connect(this.#effects.reverbInput)
    synth.connect(this.#effects.echoInput)

    synth.programChange(CHANNEL, this.#program)
  }

  get notes(): readonly number[] {
    return this.#notes
  }

  get voice(): VoiceSpec {
    return this.#voice
  }

  get program(): number {
    return this.#program
  }

  /**
   * Tient un accord.
   *
   * Les notes communes a l'accord precedent ne sont **pas** relancees : sur un
   * pad, reattaquer une note deja tenue s'entend comme un accroc, alors que
   * l'enchainement doit etre continu.
   */
  play(notes: readonly number[]): void {
    if (this.#disposed || notes.length === 0) return

    const suivant = new Set(notes)
    for (const note of this.#notes) {
      if (!suivant.has(note)) this.#synth.noteOff(CHANNEL, note)
    }

    const tenues = new Set(this.#notes)
    for (const note of notes) {
      if (!tenues.has(note)) this.#synth.noteOn(CHANNEL, note, VELOCITY)
    }

    this.#notes = [...notes]
  }

  stop(): void {
    for (const note of this.#notes) this.#synth.noteOff(CHANNEL, note)
    this.#notes = []
  }

  /** Change de programme sans couper : l'accord tenu est relance sur le nouveau son. */
  setProgram(program: number): void {
    if (program === this.#program) return
    this.#program = program

    const tenues = this.#notes
    this.stop()
    this.#synth.programChange(CHANNEL, program)
    if (tenues.length > 0) this.play(tenues)
  }

  /** N'agit que sur les effets : la source, elle, est echantillonnee. */
  setVoice(id: string): void {
    const next = voiceById(id)
    if (next.id === this.#voice.id) return
    this.#voice = next
    this.#effects.setSpec(next)
  }

  setVolume(value: number): void {
    this.#effects.setVolume(value)
  }

  setSmoothness(_value: number): void {
    // Les temps de fondu appartiennent aux enveloppes de la banque : les
    // modifier demanderait de reecrire les generateurs SoundFont. Le reglage
    // reste accepte pour que les deux sources aient la meme surface.
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.stop()
    this.#synth.disconnect()
    this.#effects.dispose()
  }

  /** Contexte audio, pour les appelants qui doivent le reprendre sur un geste. */
  get context(): AudioContext {
    return this.#context
  }
}
