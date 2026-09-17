/**
 * Implementation minimale de Web Audio pour les tests.
 *
 * Elle n'emet aucun son : elle enregistre ce que le lecteur *planifie*. C'est
 * exactement ce qu'on veut verifier — qu'un unique instant de demarrage est partage
 * par toutes les pistes, et qu'un seek le recalcule sans introduire de decalage.
 * Le temps est pilote a la main par `advance()`.
 */

export interface StartCall {
  readonly when: number
  readonly offset: number
}

export class FakeAudioParam {
  value: number
  /** Derniere cible demandee via setTargetAtTime : c'est le gain effectif vise. */
  target: number

  constructor(value: number) {
    this.value = value
    this.target = value
  }

  cancelScheduledValues(_when: number): void {}

  setTargetAtTime(target: number, _startTime: number, _timeConstant: number): void {
    this.target = target
    this.value = target
  }
}

export class FakeGainNode {
  readonly gain: FakeAudioParam
  readonly connections = new Set<object>()
  disconnected = false

  constructor(value = 1) {
    this.gain = new FakeAudioParam(value)
  }

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.disconnected = true
    this.connections.clear()
  }
}

export class FakeAudioBuffer {
  readonly duration: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly length: number
  readonly #channels: Float32Array[]

  constructor(duration: number, sampleRate = 44_100, channels = 1) {
    this.duration = duration
    this.sampleRate = sampleRate
    this.numberOfChannels = channels
    this.length = Math.round(duration * sampleRate)
    this.#channels = Array.from({ length: channels }, () => new Float32Array(this.length))
  }

  getChannelData(index: number): Float32Array {
    const channel = this.#channels[index]
    if (!channel) throw new Error(`canal ${index} inexistant`)
    return channel
  }
}

export class FakeBufferSourceNode {
  buffer: FakeAudioBuffer | null = null
  onended: (() => void) | null = null
  readonly startCalls: StartCall[] = []
  stopped = false
  disconnected = false
  #started = false

  connect(_destination: object): void {}

  disconnect(): void {
    this.disconnected = true
  }

  start(when: number, offset = 0): void {
    if (this.#started) throw new Error('source deja demarree')
    this.#started = true
    this.startCalls.push({ when, offset })
  }

  stop(_when?: number): void {
    if (!this.#started) throw new Error('source jamais demarree')
    this.stopped = true
  }
}

export class FakeAudioContext {
  currentTime = 0
  state: AudioContextState = 'running'
  readonly sampleRate: number
  readonly destination = { id: 'destination' }
  readonly createdSources: FakeBufferSourceNode[] = []
  readonly createdGains: FakeGainNode[] = []
  closed = false

  constructor(options: { sampleRate?: number } = {}) {
    this.sampleRate = options.sampleRate ?? 44_100
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode()
    this.createdGains.push(gain)
    return gain
  }

  createBufferSource(): FakeBufferSourceNode {
    const source = new FakeBufferSourceNode()
    this.createdSources.push(source)
    return source
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length / sampleRate, sampleRate, channels)
  }

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
  }

  /** Avance l'horloge audio, comme le ferait le materiel. */
  advance(seconds: number): void {
    this.currentTime += seconds
  }

  /** Sources effectivement demarrees et non arretees. */
  get liveSources(): FakeBufferSourceNode[] {
    return this.createdSources.filter((s) => s.startCalls.length > 0 && !s.stopped)
  }
}

/** Le lecteur attend un AudioContext : le faux en implemente la surface utilisee. */
export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext
}

export function asAudioBuffer(fake: FakeAudioBuffer): AudioBuffer {
  return fake as unknown as AudioBuffer
}
