import type { StemType } from '@stemlab/contracts'
import { describe, expect, it, vi } from 'vitest'
import { BufferSourceEngine } from '../src/engines/buffer-engine.js'
import { createPlaybackEngine } from '../src/engines/create.js'
import { StretchEngine, toChannelArrays } from '../src/engines/stretch-engine.js'
import type { LoadedStem } from '../src/types.js'
import {
  FakeAudioBuffer,
  FakeAudioContext,
  asAudioBuffer,
  asAudioContext,
} from './fake-audio-context.js'

const STEM_TYPES: StemType[] = ['vocals', 'drums', 'bass', 'other']

function makeStems(duration = 10): LoadedStem[] {
  return STEM_TYPES.map((type) => ({
    type,
    buffer: asAudioBuffer(new FakeAudioBuffer(duration)),
  }))
}

describe('BufferSourceEngine', () => {
  it('expose une sortie par piste', () => {
    const context = new FakeAudioContext()
    const engine = new BufferSourceEngine(asAudioContext(context), makeStems())

    for (const type of STEM_TYPES) {
      expect(engine.outputFor(type)).toBeDefined()
    }
    expect(engine.outputFor('piano')).toBeUndefined()
  })

  it('annonce ne pas dissocier tempo et hauteur', () => {
    const engine = new BufferSourceEngine(asAudioContext(new FakeAudioContext()), makeStems())
    expect(engine.supportsIndependentPitch).toBe(false)
    // Une source classique demarre a l'instant demande, sans preparation.
    expect(engine.startLead).toBe(0)
  })

  it('demarre toutes les pistes sur l instant demande, sans lookahead ajoute', () => {
    const context = new FakeAudioContext()
    context.currentTime = 4
    const engine = new BufferSourceEngine(asAudioContext(context), makeStems())

    engine.start({ when: 7.5, offset: 2, rate: 1, semitones: 0 })

    const starts = context.liveSources.flatMap((source) => source.startCalls)
    expect(starts).toHaveLength(4)
    expect(new Set(starts.map((call) => call.when))).toEqual(new Set([7.5]))
    expect(new Set(starts.map((call) => call.offset))).toEqual(new Set([2]))
  })

  it('applique la vitesse aux sources', () => {
    const context = new FakeAudioContext()
    const engine = new BufferSourceEngine(asAudioContext(context), makeStems())

    engine.start({ when: 1, offset: 0, rate: 0.75, semitones: 0 })
    for (const source of context.liveSources) {
      expect(source.playbackRate.value).toBe(0.75)
    }

    engine.setRate(1.25, null)
    for (const source of context.liveSources) {
      expect(source.playbackRate.value).toBe(1.25)
    }
  })

  it('ignore une transposition', () => {
    const engine = new BufferSourceEngine(asAudioContext(new FakeAudioContext()), makeStems())
    expect(() => engine.setSemitones(-3, null)).not.toThrow()
  })

  it('arrete toutes les sources', () => {
    const context = new FakeAudioContext()
    const engine = new BufferSourceEngine(asAudioContext(context), makeStems())

    engine.start({ when: 1, offset: 0, rate: 1, semitones: 0 })
    const sources = [...context.createdSources]
    engine.stop()
    expect(sources.every((source) => source.stopped)).toBe(true)
  })

  it('rend la duree de la piste la plus longue', () => {
    const stems: LoadedStem[] = [
      { type: 'vocals', buffer: asAudioBuffer(new FakeAudioBuffer(9.5)) },
      { type: 'drums', buffer: asAudioBuffer(new FakeAudioBuffer(10.2)) },
    ]
    expect(new BufferSourceEngine(asAudioContext(new FakeAudioContext()), stems).duration).toBe(
      10.2,
    )
  })
})

describe('toChannelArrays', () => {
  it('rend deux canaux par piste', () => {
    const stems = makeStems(1)
    const channels = toChannelArrays(stems, stems[0]!.buffer.length)
    expect(channels).toHaveLength(STEM_TYPES.length * 2)
  })

  it('complete au silence une piste plus courte', () => {
    // Demucs rend parfois des stems a quelques echantillons pres : le noeud, lui,
    // exige des canaux de longueur identique.
    const stems: LoadedStem[] = [
      { type: 'vocals', buffer: asAudioBuffer(new FakeAudioBuffer(1, 1000, 1)) },
      { type: 'drums', buffer: asAudioBuffer(new FakeAudioBuffer(0.5, 1000, 1)) },
    ]
    const channels = toChannelArrays(stems, 1000)
    expect(channels.every((channel) => channel.length === 1000)).toBe(true)
    // La seconde moitie du stem court est silencieuse.
    expect(channels[2]!.slice(500).every((value) => value === 0)).toBe(true)
  })

  it('duplique une piste mono sur deux canaux', () => {
    const buffer = new FakeAudioBuffer(1, 1000, 1)
    buffer.getChannelData(0)[10] = 0.5
    const channels = toChannelArrays([{ type: 'bass', buffer: asAudioBuffer(buffer) }], 1000)
    expect(channels).toHaveLength(2)
    expect(channels[0]![10]).toBeCloseTo(0.5)
    expect(channels[1]![10]).toBeCloseTo(0.5)
  })
})

describe('StretchEngine', () => {
  function fakeNode() {
    const scheduled: Array<Record<string, unknown>> = []
    const node = {
      addBuffers: vi.fn(async (_channels: Float32Array[]) => 10),
      schedule: vi.fn((options: Record<string, unknown>) => scheduled.push(options)),
      stop: vi.fn(),
      latency: vi.fn(async () => 0.12),
      setUpdateInterval: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      inputTime: 0,
    }
    return { node, scheduled }
  }

  async function makeEngine(context = new FakeAudioContext()) {
    const { node, scheduled } = fakeNode()
    const engine = await StretchEngine.create(
      asAudioContext(context),
      makeStems(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doublure de noeud
      async () => node as any,
    )
    return { engine, node, scheduled, context }
  }

  it('charge toutes les pistes dans un seul noeud', async () => {
    const { node } = await makeEngine()
    expect(node.addBuffers).toHaveBeenCalledOnce()
    // Huit canaux pour quatre pistes : une seule analyse pilote l'ensemble, et
    // la derive entre pistes devient structurellement impossible.
    expect(node.addBuffers.mock.calls[0]?.[0]).toHaveLength(8)
  })

  it('expose une sortie stereo par piste', async () => {
    const { engine, context } = await makeEngine()
    for (const type of STEM_TYPES) {
      expect(engine.outputFor(type)).toBeDefined()
    }
    expect(context.createdMergers).toHaveLength(4)
    expect(context.createdSplitters[0]?.channels).toBe(8)
  })

  it('annonce dissocier tempo et hauteur', async () => {
    const { engine } = await makeEngine()
    expect(engine.supportsIndependentPitch).toBe(true)
    // Le noeud compense sa latence : il lui faut une avance pour le faire.
    expect(engine.startLead).toBeGreaterThan(0)
  })

  it('planifie le demarrage avec position, vitesse et hauteur', async () => {
    const context = new FakeAudioContext()
    context.currentTime = 2
    const { engine, scheduled } = await makeEngine(context)

    engine.start({ when: 2.5, offset: 12, rate: 0.75, semitones: -3 })

    expect(scheduled.at(-1)).toMatchObject({
      output: 2.5,
      active: true,
      input: 12,
      rate: 0.75,
      semitones: -3,
    })
  })

  it('arrete la lecture', async () => {
    const { engine, scheduled } = await makeEngine()
    engine.start({ when: 1, offset: 0, rate: 1, semitones: 0 })
    engine.stop()
    expect(scheduled.at(-1)).toMatchObject({ active: false })
  })

  it('ne planifie rien a l arret', async () => {
    const { engine, scheduled } = await makeEngine()
    engine.setRate(0.5, null)
    engine.setSemitones(2, null)
    expect(scheduled).toHaveLength(0)
  })

  it('change la vitesse en cours de lecture', async () => {
    const { engine, scheduled } = await makeEngine()
    engine.start({ when: 1, offset: 0, rate: 1, semitones: 0 })
    engine.setRate(0.75, { when: 2, offset: 5, rate: 0.75, semitones: 0 })

    expect(scheduled.at(-1)).toMatchObject({ active: true, rate: 0.75, input: 5 })
  })

  it('refuse un chargement sans piste', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doublure de noeud
      StretchEngine.create(asAudioContext(new FakeAudioContext()), [], async () => ({}) as any),
    ).rejects.toThrow(/aucune piste/)
  })
})

describe('createPlaybackEngine', () => {
  it('retombe sur les sources classiques quand l etirement echoue', async () => {
    const onFallback = vi.fn()
    const engine = await createPlaybackEngine(asAudioContext(new FakeAudioContext()), makeStems(), {
      loadStretchFactory: async () => {
        throw new Error('AudioWorklet indisponible')
      },
      onFallback,
    })

    expect(engine).toBeInstanceOf(BufferSourceEngine)
    expect(engine.supportsIndependentPitch).toBe(false)
    // L'interface doit pouvoir dire pourquoi la transposition est inoperante.
    expect(onFallback).toHaveBeenCalledOnce()
    expect(onFallback.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('rapporte la latence du noeud', async () => {
    const node = {
      addBuffers: vi.fn(async (_channels: Float32Array[]) => 10),
      schedule: vi.fn(),
      setUpdateInterval: vi.fn(),
      latency: vi.fn(async () => 0.12),
      connect: vi.fn(),
      disconnect: vi.fn(),
      inputTime: 0,
    }

    const engine = await createPlaybackEngine(
      asAudioContext(new FakeAudioContext()),
      makeStems(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doublure de noeud
      { loadStretchFactory: async () => async () => node as any },
    )

    // Sans cette valeur, tout ce qui doit tomber avec le son arrive en avance.
    expect(engine.outputLatency).toBeCloseTo(0.12, 5)
  })

  it('se passe d une latence illisible sans perdre l etirement', async () => {
    const node = {
      addBuffers: vi.fn(async (_channels: Float32Array[]) => 10),
      schedule: vi.fn(),
      setUpdateInterval: vi.fn(),
      latency: vi.fn(() => {
        throw new Error('non disponible')
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      inputTime: 0,
    }

    const engine = await createPlaybackEngine(
      asAudioContext(new FakeAudioContext()),
      makeStems(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doublure de noeud
      { loadStretchFactory: async () => async () => node as any },
    )

    // Au pire, le metronome retrouve le decalage qu'il avait avant : ce n'est
    // pas une raison de priver l'utilisateur du tempo independant.
    expect(engine.supportsIndependentPitch).toBe(true)
    expect(engine.outputLatency).toBe(0)
  })

  it('retient l etirement quand il se charge', async () => {
    const { node } = {
      node: {
        addBuffers: vi.fn(async (_channels: Float32Array[]) => 10),
        schedule: vi.fn(),
        setUpdateInterval: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        inputTime: 0,
      },
    }
    const engine = await createPlaybackEngine(
      asAudioContext(new FakeAudioContext()),
      makeStems(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doublure de noeud
      { loadStretchFactory: async () => async () => node as any },
    )
    expect(engine.supportsIndependentPitch).toBe(true)
  })
})
