/**
 * Reverberation par convolution, sur une reponse impulsionnelle synthetisee.
 *
 * Aucun fichier a telecharger. La queue est un bruit qui decroit — la forme
 * meme d'une reverberation de salle — auquel trois choses donnent son realisme :
 *
 * - un **pre-delai** : le silence entre le son direct et la premiere reflexion.
 *   C'est lui qui place la salle a distance au lieu de noyer l'attaque ;
 * - un **amortissement** progressif des aigus. Dans une vraie salle, les hautes
 *   frequences meurent les premieres ; sans cela, la queue siffle ;
 * - une **decorrelation** des deux canaux. Deux bruits identiques a gauche et a
 *   droite s'entendent au centre, pas autour de l'auditeur.
 */

export interface ReverbOptions {
  /** Duree de la queue, en secondes. */
  readonly seconds?: number
  /** Pente de la decroissance. Plus la valeur est haute, plus la queue est courte. */
  readonly decay?: number
  /** Silence avant la premiere reflexion, en secondes. */
  readonly preDelay?: number
  /** Attenuation des aigus le long de la queue, entre 0 et 1. */
  readonly damping?: number
}

export function createImpulseResponse(
  context: BaseAudioContext,
  options: ReverbOptions = {},
): AudioBuffer {
  const seconds = options.seconds ?? 3.5
  const decay = options.decay ?? 2.4
  const preDelay = options.preDelay ?? 0.02
  const damping = options.damping ?? 0.45

  const rate = context.sampleRate
  const length = Math.max(1, Math.floor(rate * (seconds + preDelay)))
  const silent = Math.floor(rate * preDelay)
  const buffer = context.createBuffer(2, length, rate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)

    // Passe-bas du pauvre, applique echantillon par echantillon : son coefficient
    // se resserre le long de la queue, donc les aigus s'eteignent avant les graves.
    let previous = 0

    for (let i = silent; i < length; i++) {
      const progress = (i - silent) / (length - silent)
      const envelope = (1 - progress) ** decay

      // Les premieres millisecondes sont adoucies : sans cela, la reverberation
      // claque au lieu de s'ouvrir.
      const onset = Math.min(1, (i - silent) / (rate * 0.008))

      const noise = Math.random() * 2 - 1
      const smoothing = damping * progress
      previous = previous * smoothing + noise * (1 - smoothing)

      data[i] = previous * envelope * onset
    }
  }

  return buffer
}

export function createReverb(context: BaseAudioContext, options?: ReverbOptions): ConvolverNode {
  const convolver = context.createConvolver()
  convolver.buffer = createImpulseResponse(context, options)
  return convolver
}

/**
 * Courbe de saturation douce.
 *
 * `tanh` plutot qu'un ecretage : elle comprime progressivement les pics au lieu
 * de les couper, ce qui epaissit le son sans y ajouter de grain. A `amount` nul,
 * la courbe est la droite identite et l'etage devient transparent.
 */
export function createDriveCurve(amount: number, samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4))
  const k = Math.max(0, amount) * 8

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1
    curve[i] = k === 0 ? x : Math.tanh(x * (1 + k)) / Math.tanh(1 + k)
  }

  return curve
}
