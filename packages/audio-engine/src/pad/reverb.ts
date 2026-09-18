/**
 * Reverberation par convolution, sur une reponse impulsionnelle synthetisee.
 *
 * Aucun fichier a telecharger : la reponse est un bruit dont l'amplitude decroit
 * exponentiellement, ce qui est exactement la forme d'une queue de reverberation
 * dans une salle. Un fichier enregistre sonnerait plus juste, mais couterait
 * quelques centaines de kilo-octets pour un gain que personne n'entendrait sous
 * une nappe tenue.
 */

export interface ReverbOptions {
  /** Duree de la queue, en secondes. */
  readonly seconds?: number
  /** Pente de la decroissance. Plus la valeur est haute, plus la queue est courte. */
  readonly decay?: number
}

export function createImpulseResponse(
  context: BaseAudioContext,
  options: ReverbOptions = {},
): AudioBuffer {
  const seconds = options.seconds ?? 3.2
  const decay = options.decay ?? 2.6
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const buffer = context.createBuffer(2, length, context.sampleRate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const progress = i / length
      // Les premieres millisecondes sont attenuees : sans cela, l'attaque de la
      // reverberation claque au lieu de s'ouvrir.
      const onset = Math.min(1, i / (context.sampleRate * 0.01))
      data[i] = (Math.random() * 2 - 1) * (1 - progress) ** decay * onset
    }
  }

  return buffer
}

export function createReverb(context: BaseAudioContext, options?: ReverbOptions): ConvolverNode {
  const convolver = context.createConvolver()
  convolver.buffer = createImpulseResponse(context, options)
  return convolver
}
