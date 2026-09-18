import { createDriveCurve, createReverb } from './reverb.js'
import type { VoiceSpec } from './voices.js'

/**
 * Chaine d'effets d'ambiance, partagee par les deux sources sonores.
 *
 * La reverberation remplit l'espace, l'echo remplit le temps. Les deux sont des
 * **envois** et non des inserts : ils vivent en dehors des accords et continuent
 * de sonner pendant que le suivant monte. C'est precisement ce qui donne sa
 * continuite a une nappe — la couper entre deux accords s'entendrait aussitot.
 *
 * Deux etages de securite en sortie, pour deux problemes distincts. Le
 * compresseur tasse les cretes musicales ; la courbe de saturation, elle, borne
 * mathematiquement la sortie a plus ou moins un. Un compresseur seul laisse
 * passer ce qui arrive plus vite que son temps d'attaque.
 */
export class PadEffects {
  readonly #context: AudioContext
  readonly #master: GainNode
  readonly #dry: GainNode
  readonly #wet: GainNode
  readonly #echo: GainNode
  readonly #softClip: WaveShaperNode
  readonly #limiter: DynamicsCompressorNode

  #reverb: ConvolverNode
  #echoNodes: AudioNode[] = []
  #spec: VoiceSpec

  constructor(context: AudioContext, spec: VoiceSpec, volume = 0.7) {
    this.#context = context
    this.#spec = spec

    this.#softClip = context.createWaveShaper()
    this.#softClip.curve = createDriveCurve(0.08)
    this.#softClip.oversample = '2x'
    this.#softClip.connect(context.destination)

    this.#limiter = context.createDynamicsCompressor()
    this.#limiter.threshold.value = -4
    this.#limiter.knee.value = 6
    this.#limiter.ratio.value = 12
    this.#limiter.attack.value = 0.004
    this.#limiter.release.value = 0.25
    this.#limiter.connect(this.#softClip)

    this.#master = context.createGain()
    this.#master.gain.value = volume
    this.#master.connect(this.#limiter)

    this.#dry = context.createGain()
    this.#dry.connect(this.#master)

    this.#wet = context.createGain()
    this.#reverb = createReverb(context, spec.reverb)
    this.#wet.connect(this.#reverb)
    this.#reverb.connect(this.#master)

    this.#echo = context.createGain()
    this.#buildEcho()
    this.#applyMix()
  }

  /** Entree du son direct : elle part au haut-parleur, a la salle et a l'echo. */
  get input(): AudioNode {
    return this.#dry
  }

  /** Entree reservee a la reverberation : rien de ce qui entre ici n'est entendu au premier plan. */
  get reverbInput(): AudioNode {
    return this.#wet
  }

  get echoInput(): AudioNode {
    return this.#echo
  }

  setVolume(value: number): void {
    const now = this.#context.currentTime
    this.#master.gain.cancelScheduledValues(now)
    this.#master.gain.setTargetAtTime(clamp(value, 0, 1), now, 0.05)
  }

  /** Change de salle et d'echo. La queue en cours s'eteint avec l'ancienne. */
  setSpec(spec: VoiceSpec): void {
    this.#spec = spec

    const reverb = createReverb(this.#context, spec.reverb)
    this.#wet.disconnect()
    this.#reverb.disconnect()
    this.#reverb = reverb
    this.#wet.connect(reverb)
    reverb.connect(this.#master)

    this.#buildEcho()
    this.#applyMix()
  }

  dispose(): void {
    for (const node of this.#echoNodes) node.disconnect()
    this.#echoNodes = []
    this.#echo.disconnect()
    this.#dry.disconnect()
    this.#wet.disconnect()
    this.#reverb.disconnect()
    this.#master.disconnect()
    this.#limiter.disconnect()
    this.#softClip.disconnect()
  }

  #applyMix(): void {
    const now = this.#context.currentTime
    const mix = this.#spec.reverb.mix
    this.#wet.gain.setTargetAtTime(mix, now, 0.08)
    // La part directe ne descend pas a zero : une nappe entierement reverberee
    // perd son point d'ancrage et semble venir d'ailleurs.
    this.#dry.gain.setTargetAtTime(1 - mix * 0.45, now, 0.08)
  }

  /**
   * Echo stereo alterne, reinjecte sur lui-meme.
   *
   * Ce qui sort a gauche rentre a droite, et inversement. Un passe-bas dans la
   * boucle assombrit chaque repetition : un echo qui garde ses aigus s'entend
   * comme une repetition, pas comme un lointain.
   */
  #buildEcho(): void {
    const context = this.#context
    const spec = this.#spec.delay

    for (const node of this.#echoNodes) node.disconnect()
    this.#echoNodes = []
    this.#echo.disconnect()

    if (spec.mix <= 0) return

    const left = context.createDelay(2)
    const right = context.createDelay(2)
    left.delayTime.value = spec.time
    right.delayTime.value = spec.time

    const damping = context.createBiquadFilter()
    damping.type = 'lowpass'
    damping.frequency.value = spec.damping

    const feedback = context.createGain()
    // Au-dela de 0,7, l'echo ne s'eteint plus et sature la chaine.
    feedback.gain.value = Math.min(0.7, spec.feedback)

    const panLeft = context.createStereoPanner()
    panLeft.pan.value = -0.85
    const panRight = context.createStereoPanner()
    panRight.pan.value = 0.85

    const level = context.createGain()
    level.gain.value = spec.mix

    this.#echo.connect(left)
    left.connect(panLeft)
    left.connect(right)
    right.connect(panRight)
    right.connect(damping)
    damping.connect(feedback)
    feedback.connect(left)

    panLeft.connect(level)
    panRight.connect(level)
    level.connect(this.#master)
    // L'echo alimente aussi la salle : sans cela, les repetitions sonnent devant
    // la nappe au lieu d'etre dedans.
    level.connect(this.#wet)

    this.#echoNodes = [left, right, damping, feedback, panLeft, panRight, level]
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
