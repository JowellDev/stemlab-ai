import { createDriveCurve, createReverb } from './reverb.js'
import { type Layer, type VoiceSpec, voiceById } from './voices.js'

/**
 * Pad d'accords tenus.
 *
 * Deux idees structurent le moteur.
 *
 * **Un accord, une chaine.** Passer d'un accord au suivant ne doit jamais
 * laisser de trou : chaque accord vit dans ses propres oscillateurs, et le
 * suivant monte pendant que le precedent descend. Reconfigurer des oscillateurs
 * en cours de route produirait un glissando, pas un fondu.
 *
 * **Le mouvement avant les harmoniques.** Ce qui distingue une nappe d'un orgue
 * de test, ce n'est pas le nombre de partiels : c'est l'unisson desaccorde, la
 * derive lente de chaque oscillateur, le filtre qui respire et l'elargissement
 * stereo. Tout cela est reconstruit pour chaque accord — c'est le prix a payer
 * pour que deux accords successifs ne soient jamais exactement identiques.
 *
 * Chaine, de la note a la sortie :
 *
 *     oscillateurs (unisson, derive) → panoramique → filtre (enveloppe + LFO)
 *       → saturation → ensemble (retards modules) → enveloppe → direct + reverbe
 */

export interface ChordPadOptions {
  readonly voice?: string
  /** Gain general, entre 0 et 1. */
  readonly volume?: number
  /** Multiplie l'attaque et la descente de la voix. */
  readonly smoothness?: number
}

interface Layer_ {
  readonly gain: GainNode
  /** Enveloppe des strates reservees a la reverberation. */
  readonly shimmer: GainNode
  readonly nodes: readonly AudioScheduledSourceNode[]
  /** Instant a partir duquel les noeuds peuvent etre liberes. */
  stopsAt: number
}

export const MIN_SMOOTHNESS = 0.4
export const MAX_SMOOTHNESS = 2.5

/** Au-dela, on empile des oscillateurs que personne n'entend. */
const MAX_UNISON = 7

export class ChordPad {
  readonly #context: AudioContext
  readonly #dry: GainNode
  readonly #wet: GainNode
  readonly #master: GainNode
  readonly #echo: GainNode
  #reverb: ConvolverNode
  #echoNodes: AudioNode[] = []

  #voice: VoiceSpec
  #smoothness: number
  #layers: Layer_[] = []
  #notes: readonly number[] = []
  #disposed = false

  constructor(context: AudioContext, options: ChordPadOptions = {}) {
    this.#context = context
    this.#voice = voiceById(options.voice ?? 'warm')
    this.#smoothness = clamp(options.smoothness ?? 1, MIN_SMOOTHNESS, MAX_SMOOTHNESS)

    // Deux etages de securite, pour deux problemes distincts.
    //
    // Le compresseur rattrape les cretes musicales — un accord dense a la
    // douceur maximale, ou un echo qui s'accumule — en les tassant plutot qu'en
    // les coupant. Mais un compresseur n'est pas un limiteur : il laisse passer
    // ce qui arrive plus vite que son temps d'attaque.
    //
    // La courbe qui suit, elle, borne mathematiquement la sortie a plus ou moins
    // un. C'est elle qui garantit l'absence d'ecretage, quelle que soit la
    // combinaison de reglages.
    const softClip = context.createWaveShaper()
    softClip.curve = createDriveCurve(0.08)
    softClip.oversample = '2x'
    softClip.connect(context.destination)

    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -4
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.004
    limiter.release.value = 0.25
    limiter.connect(softClip)

    this.#master = context.createGain()
    this.#master.gain.value = options.volume ?? 0.7
    this.#master.connect(limiter)

    this.#dry = context.createGain()
    this.#dry.connect(this.#master)

    this.#wet = context.createGain()
    this.#reverb = createReverb(context, this.#voice.reverb)
    this.#wet.connect(this.#reverb)
    this.#reverb.connect(this.#master)

    // L'echo est un envoi, pas un insert : il vit hors des accords et continue
    // de repeter pendant que le suivant monte. C'est precisement ce qui donne sa
    // continuite a une nappe d'ambiance.
    this.#echo = context.createGain()
    this.#buildEcho()

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
   * Rejouer exactement le meme accord ne redeclenche rien : appuyer deux fois
   * sur le meme bouton ne doit pas produire de battement.
   */
  play(notes: readonly number[]): void {
    if (this.#disposed || notes.length === 0) return
    if (sameNotes(this.#notes, notes)) return

    this.#release()
    this.#layers.push(this.#buildChord(notes))
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

    // La queue de reverberation appartient au timbre : une nappe de verre ne se
    // pose pas dans la meme salle qu'un orgue.
    const reverb = createReverb(this.#context, next.reverb)
    this.#wet.disconnect()
    this.#reverb.disconnect()
    this.#reverb = reverb
    this.#wet.connect(reverb)
    reverb.connect(this.#master)
    this.#buildEcho()
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
      layer.shimmer.disconnect()
    }
    this.#layers = []
    this.#notes = []
    for (const node of this.#echoNodes) node.disconnect()
    this.#echoNodes = []
    this.#echo.disconnect()
    this.#master.disconnect()
    this.#dry.disconnect()
    this.#wet.disconnect()
    this.#reverb.disconnect()
  }

  // --- construction d'un accord --------------------------------------------

  /**
   * Echo stereo alterne, reinjecte sur lui-meme.
   *
   * Deux lignes a retard qui se nourrissent l'une l'autre : ce qui sort a
   * gauche rentre a droite, et inversement. Un passe-bas dans la boucle
   * assombrit chaque repetition — sans lui, l'echo s'entend comme une
   * repetition, pas comme un lointain.
   */
  #buildEcho(): void {
    const context = this.#context
    const spec = this.#voice.delay

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
    // L'echo alimente aussi la salle : sans cela, les repetitions sonnent
    // devant la nappe au lieu d'etre dedans.
    level.connect(this.#wet)

    this.#echoNodes = [left, right, damping, feedback, panLeft, panRight, level]
  }

  #applyMix(): void {
    const now = this.#context.currentTime
    const mix = this.#voice.reverb.mix
    this.#wet.gain.setTargetAtTime(mix, now, 0.08)
    // La part directe ne descend pas a zero : une nappe entierement reverberee
    // perd son point d'ancrage et semble venir d'ailleurs.
    this.#dry.gain.setTargetAtTime(1 - mix * 0.45, now, 0.08)
  }

  #buildChord(notes: readonly number[]): Layer_ {
    const context = this.#context
    const voice = this.#voice
    const now = context.currentTime
    const attack = voice.attack * this.#smoothness

    // --- sortie de l'accord -------------------------------------------------
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, now)
    // Montee exponentielle : l'oreille percoit le volume en decibels, et une
    // rampe lineaire s'entend comme une arrivee brutale suivie d'un plateau.
    envelope.gain.exponentialRampToValueAtTime(voice.output, now + attack)
    envelope.connect(this.#dry)
    envelope.connect(this.#wet)
    envelope.connect(this.#echo)

    // Les strates reservees a la reverberation ont leur propre enveloppe : elles
    // ne doivent atteindre ni le son direct, ni l'echo.
    const shimmer = context.createGain()
    shimmer.gain.setValueAtTime(0.0001, now)
    shimmer.gain.exponentialRampToValueAtTime(voice.output, now + attack)
    shimmer.connect(this.#wet)

    const nodes: AudioScheduledSourceNode[] = []

    // --- ensemble : deux retards modules, en opposition de phase -------------
    const ensembleInput = context.createGain()
    if (voice.chorus.mix > 0) {
      ensembleInput.connect(envelope)
      for (const [index, side] of [-1, 1].entries()) {
        const { nodes: added } = this.#buildEnsembleBranch(
          ensembleInput,
          envelope,
          side,
          index,
          now,
        )
        nodes.push(...added)
      }
    } else {
      ensembleInput.connect(envelope)
    }

    // --- saturation ---------------------------------------------------------
    let head: AudioNode = ensembleInput
    if (voice.drive > 0) {
      const shaper = context.createWaveShaper()
      shaper.curve = createDriveCurve(voice.drive)
      shaper.oversample = '2x'
      shaper.connect(ensembleInput)
      head = shaper
    }

    // --- filtre, ouvert par l'enveloppe et anime par un LFO ------------------
    const filter = context.createBiquadFilter()
    filter.type = voice.filter.type
    filter.Q.value = voice.filter.q
    filter.connect(head)

    const base = voice.filter.frequency
    filter.frequency.setValueAtTime(base / 2 ** voice.filter.envelope, now)
    filter.frequency.linearRampToValueAtTime(base, now + attack)

    if (voice.filter.lfoDepth > 0) {
      const lfo = context.createOscillator()
      lfo.frequency.value = voice.filter.lfoRate
      const depth = context.createGain()
      // La profondeur est exprimee en octaves : on la convertit en hertz autour
      // du point de coupure, sinon le meme reglage serait inaudible dans le
      // grave et brutal dans l'aigu.
      depth.gain.value = base * (2 ** voice.filter.lfoDepth - 1) * 0.5
      lfo.connect(depth)
      depth.connect(filter.frequency)
      lfo.start(now)
      nodes.push(lfo)
    }

    // --- oscillateurs -------------------------------------------------------
    const weight = totalWeight(voice) * Math.sqrt(notes.length)

    // Une strate reservee a la reverberation contourne le filtre et l'ensemble :
    // elle n'a rien a faire dans le chemin direct.
    for (const note of notes) {
      const frequency = midiToFrequency(note)
      for (const layer of voice.layers) {
        const destination = layer.reverbOnly ? shimmer : filter
        nodes.push(...this.#buildLayer(layer, frequency, weight, destination, now))
      }
    }

    if (voice.breath) {
      nodes.push(this.#buildBreath(voice.breath / Math.sqrt(notes.length), filter, now))
    }

    return { gain: envelope, shimmer, nodes, stopsAt: Number.POSITIVE_INFINITY }
  }

  /**
   * Une strate : `unison` oscillateurs desaccordes et repartis dans l'espace.
   *
   * L'ecart est reparti symetriquement autour de la note, et le panoramique suit
   * le meme axe : l'oscillateur le plus bas part a gauche, le plus haut a
   * droite. C'est ce qui fait qu'un unisson s'entend large plutot qu'epais.
   */
  #buildLayer(
    layer: Layer,
    frequency: number,
    weight: number,
    destination: AudioNode,
    now: number,
  ): AudioScheduledSourceNode[] {
    const context = this.#context
    const count = Math.min(MAX_UNISON, Math.max(1, layer.unison))
    const nodes: AudioScheduledSourceNode[] = []
    const start = now + (layer.delay ?? 0)

    for (let index = 0; index < count; index++) {
      // De -1 a 1 ; un unisson d'un seul oscillateur reste au centre.
      const position = count === 1 ? 0 : (index / (count - 1)) * 2 - 1

      const oscillator = context.createOscillator()
      oscillator.type = layer.type
      oscillator.frequency.value = frequency * layer.ratio
      oscillator.detune.value = (position * layer.detune) / 2

      if (layer.drift) {
        // Chaque oscillateur derive a son propre rythme, entre 4 et 12 secondes
        // de periode. Une derive commune s'entendrait comme un vibrato.
        const drift = context.createOscillator()
        drift.frequency.value = 0.08 + Math.random() * 0.17
        const amount = context.createGain()
        amount.gain.value = layer.drift
        drift.connect(amount)
        amount.connect(oscillator.detune)
        drift.start(start)
        nodes.push(drift)
      }

      const panner = context.createStereoPanner()
      panner.pan.value = position * layer.spread

      const level = context.createGain()
      level.gain.value = layer.gain / (weight * count)

      // Une strate retardee arrive en fondu : l'entendre surgir trahirait le
      // mecanisme.
      if (layer.delay) {
        level.gain.setValueAtTime(0.0001, now)
        level.gain.exponentialRampToValueAtTime(layer.gain / (weight * count), start + 1.2)
      }

      oscillator.connect(panner)
      panner.connect(level)
      level.connect(destination)
      oscillator.start(now)
      nodes.push(oscillator)
    }

    return nodes
  }

  /** Une branche d'ensemble : un retard module, panoramique d'un cote. */
  #buildEnsembleBranch(
    source: AudioNode,
    destination: AudioNode,
    side: number,
    index: number,
    now: number,
  ): { nodes: AudioScheduledSourceNode[] } {
    const context = this.#context
    const chorus = this.#voice.chorus

    const delay = context.createDelay(0.2)
    delay.delayTime.value = chorus.delay * (1 + index * 0.35)

    const lfo = context.createOscillator()
    lfo.frequency.value = chorus.rate * (1 + index * 0.27)
    // Les deux branches sont en opposition : quand l'une s'allonge, l'autre se
    // raccourcit. C'est de cet ecart que naît la largeur.
    const depth = context.createGain()
    depth.gain.value = chorus.depth * side

    lfo.connect(depth)
    depth.connect(delay.delayTime)
    lfo.start(now)

    const panner = context.createStereoPanner()
    panner.pan.value = side * 0.8

    const level = context.createGain()
    level.gain.value = chorus.mix

    source.connect(delay)
    delay.connect(panner)
    panner.connect(level)
    level.connect(destination)

    return { nodes: [lfo] }
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
    level.gain.value = amount * 0.04

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
      for (const envelope of [layer.gain, layer.shimmer]) {
        envelope.gain.cancelScheduledValues(now)
        envelope.gain.setValueAtTime(Math.max(envelope.gain.value, 0.0001), now)
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + release)
      }
      layer.stopsAt = now + release
    }
  }

  /**
   * Libere les calques dont la descente est terminee.
   *
   * Appele a chaque accord plutot que par un minuteur : tant que personne ne
   * joue, il n'y a rien a nettoyer.
   */
  #collect(): void {
    const now = this.#context.currentTime
    this.#layers = this.#layers.filter((layer) => {
      if (layer.stopsAt > now) return true
      for (const node of layer.nodes) safeStop(node)
      layer.gain.disconnect()
      layer.shimmer.disconnect()
      return false
    })
  }
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * Somme des gains du chemin direct.
 *
 * Les strates reservees a la reverberation en sont exclues : elles ont leur
 * propre enveloppe, et les compter ici affaiblirait le son direct a mesure qu'on
 * ajoute du scintillement.
 */
function totalWeight(voice: VoiceSpec): number {
  return voice.layers.reduce((sum, layer) => (layer.reverbOnly ? sum : sum + layer.gain), 0)
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
