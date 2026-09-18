/**
 * Declarations pour `signalsmith-stretch`, qui n'en fournit pas.
 *
 * On ne decrit que la surface reellement utilisee : mieux vaut un type etroit et
 * juste qu'un type large et approximatif.
 */
declare module 'signalsmith-stretch' {
  interface SignalsmithStretchNode extends AudioNode {
    /** Ajoute des canaux de meme longueur a la fin du tampon d'entree. */
    addBuffers(channels: Float32Array[]): Promise<number>

    /** Programme un changement d'etat a un instant de l'AudioContext. */
    schedule(options: {
      output?: number
      active?: boolean
      input?: number
      rate?: number
      semitones?: number
      tonalityHz?: number
      formantSemitones?: number
      formantCompensation?: boolean
      loopStart?: number
      loopEnd?: number
    }): void

    start(
      when?: number,
      offset?: number,
      duration?: number,
      rate?: number,
      semitones?: number,
    ): void
    stop(when?: number): void

    /** Latence du traitement, en secondes. */
    latency(): Promise<number>

    /** Frequence de mise a jour de `inputTime`, en secondes. */
    setUpdateInterval(seconds: number, callback?: (time: number) => void): void

    configure(options: {
      blockMs?: number | null
      intervalMs?: number
      splitComputation?: boolean
      preset?: 'default' | 'cheaper'
    }): void

    /** Position courante dans le tampon d'entree, en secondes. */
    readonly inputTime: number
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<SignalsmithStretchNode>
}
