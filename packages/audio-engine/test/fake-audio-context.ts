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
  /** Rampes programmees, dans l'ordre : `[valeur, instant]`. */
  readonly ramps: Array<[number, number]> = []

  constructor(value: number) {
    this.value = value
    this.target = value
  }

  cancelScheduledValues(_when: number): void {}

  setTargetAtTime(target: number, _startTime: number, _timeConstant: number): void {
    this.target = target
    this.value = target
  }

  setValueAtTime(value: number, _when: number): void {
    this.value = value
  }

  exponentialRampToValueAtTime(value: number, when: number): void {
    this.ramps.push([value, when])
    this.target = value
  }

  linearRampToValueAtTime(value: number, when: number): void {
    this.ramps.push([value, when])
    this.target = value
  }
}

/**
 * Oscillateur : ce que le pad cree en quantite.
 *
 * On retient de quoi verifier la frequence jouee et le cycle de vie — c'est tout
 * ce que les tests observent.
 */
export class FakeOscillatorNode {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeAudioParam(440)
  readonly detune = new FakeAudioParam(0)
  readonly connections = new Set<object>()
  started = false
  stopped = false

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
  }

  start(_when?: number): void {
    this.started = true
  }

  stop(_when?: number): void {
    this.stopped = true
  }
}

export class FakeBiquadFilterNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeAudioParam(350)
  readonly Q = new FakeAudioParam(1)
  readonly connections = new Set<object>()

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
  }
}

export class FakeStereoPannerNode {
  readonly pan = new FakeAudioParam(0)
  readonly connections = new Set<object>()

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
  }
}

export class FakeDelayNode {
  readonly delayTime: FakeAudioParam
  readonly connections = new Set<object>()

  constructor(maxDelay = 1) {
    this.delayTime = new FakeAudioParam(Math.min(0, maxDelay))
  }

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
  }
}

export class FakeWaveShaperNode {
  curve: Float32Array | null = null
  oversample: OverSampleType = 'none'
  readonly connections = new Set<object>()

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
  }
}

export class FakeDynamicsCompressorNode {
  readonly threshold = new FakeAudioParam(-24)
  readonly knee = new FakeAudioParam(30)
  readonly ratio = new FakeAudioParam(12)
  readonly attack = new FakeAudioParam(0.003)
  readonly release = new FakeAudioParam(0.25)
  readonly connections = new Set<object>()

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
  }
}

export class FakeConvolverNode {
  buffer: FakeAudioBuffer | null = null
  readonly connections = new Set<object>()

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.connections.clear()
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
  loop = false
  readonly playbackRate = new FakeAudioParam(1)
  onended: (() => void) | null = null
  readonly startCalls: StartCall[] = []
  stopped = false
  disconnected = false
  #started = false

  readonly connections = new Set<object>()

  connect(destination: object): void {
    this.connections.add(destination)
  }

  disconnect(): void {
    this.disconnected = true
    this.connections.clear()
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

export class FakeChannelSplitterNode {
  readonly connections: Array<{ destination: object; output: number; input: number }> = []
  disconnected = false

  constructor(readonly channels: number) {}

  connect(destination: object, output = 0, input = 0): void {
    this.connections.push({ destination, output, input })
  }

  disconnect(): void {
    this.disconnected = true
  }
}

export class FakeChannelMergerNode {
  disconnected = false

  constructor(readonly channels: number) {}

  connect(_destination: object): void {}

  disconnect(): void {
    this.disconnected = true
  }
}

export class FakeAudioContext {
  currentTime = 0
  state: AudioContextState = 'running'
  readonly sampleRate: number
  readonly destination = { id: 'destination' }
  readonly createdSources: FakeBufferSourceNode[] = []
  readonly createdGains: FakeGainNode[] = []
  readonly createdSplitters: FakeChannelSplitterNode[] = []
  readonly createdMergers: FakeChannelMergerNode[] = []
  readonly createdOscillators: FakeOscillatorNode[] = []
  readonly createdFilters: FakeBiquadFilterNode[] = []
  readonly createdConvolvers: FakeConvolverNode[] = []
  readonly createdPanners: FakeStereoPannerNode[] = []
  readonly createdDelays: FakeDelayNode[] = []
  readonly createdShapers: FakeWaveShaperNode[] = []
  readonly createdCompressors: FakeDynamicsCompressorNode[] = []
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

  createChannelSplitter(channels: number): FakeChannelSplitterNode {
    const splitter = new FakeChannelSplitterNode(channels)
    this.createdSplitters.push(splitter)
    return splitter
  }

  createChannelMerger(channels: number): FakeChannelMergerNode {
    const merger = new FakeChannelMergerNode(channels)
    this.createdMergers.push(merger)
    return merger
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length / sampleRate, sampleRate, channels)
  }

  createOscillator(): FakeOscillatorNode {
    const oscillator = new FakeOscillatorNode()
    this.createdOscillators.push(oscillator)
    return oscillator
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const filter = new FakeBiquadFilterNode()
    this.createdFilters.push(filter)
    return filter
  }

  createConvolver(): FakeConvolverNode {
    const convolver = new FakeConvolverNode()
    this.createdConvolvers.push(convolver)
    return convolver
  }

  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    const compressor = new FakeDynamicsCompressorNode()
    this.createdCompressors.push(compressor)
    return compressor
  }

  createStereoPanner(): FakeStereoPannerNode {
    const panner = new FakeStereoPannerNode()
    this.createdPanners.push(panner)
    return panner
  }

  createDelay(maxDelay?: number): FakeDelayNode {
    const delay = new FakeDelayNode(maxDelay)
    this.createdDelays.push(delay)
    return delay
  }

  createWaveShaper(): FakeWaveShaperNode {
    const shaper = new FakeWaveShaperNode()
    this.createdShapers.push(shaper)
    return shaper
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

  /** Oscillateurs demarres et pas encore arretes. */
  get liveOscillators(): FakeOscillatorNode[] {
    return this.createdOscillators.filter((o) => o.started && !o.stopped)
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
