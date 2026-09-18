import type { StemType } from '@stemlab/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferSourceEngine } from '../src/engines/buffer-engine.js'
import { MultitrackPlayer } from '../src/multitrack-player.js'
import { DEFAULT_LOOKAHEAD_SECONDS } from '../src/scheduler.js'
import type { LoadedStem } from '../src/types.js'
import {
  FakeAudioBuffer,
  FakeAudioContext,
  asAudioBuffer,
  asAudioContext,
} from './fake-audio-context.js'

const TRACK_DURATION = 180
const STEM_TYPES: StemType[] = ['vocals', 'drums', 'bass', 'other']

function makeStems(duration = TRACK_DURATION): LoadedStem[] {
  return STEM_TYPES.map((type) => ({
    type,
    buffer: asAudioBuffer(new FakeAudioBuffer(duration)),
  }))
}

/**
 * Lecteur cable sur le moteur de repli.
 *
 * L'etirement temporel exige un AudioWorklet, absent de Node : l'injecter
 * explicitement evite de dependre du chemin de repli et rend le test lisible.
 */
function makePlayer(context: FakeAudioContext): MultitrackPlayer {
  return new MultitrackPlayer({
    context: asAudioContext(context),
    createEngine: async (audioContext, stems) => new BufferSourceEngine(audioContext, stems),
  })
}

describe('MultitrackPlayer — chargement', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
  })

  it('passe a `ready` et expose la duree de la piste la plus longue', async () => {
    await player.loadBuffers([
      { type: 'vocals', buffer: asAudioBuffer(new FakeAudioBuffer(120)) },
      { type: 'drums', buffer: asAudioBuffer(new FakeAudioBuffer(121.5)) },
    ])
    expect(player.state).toBe('ready')
    expect(player.duration).toBe(121.5)
  })

  it('initialise chaque piste a plein volume, non coupee, non solo', async () => {
    await player.loadBuffers(makeStems())
    for (const type of STEM_TYPES) {
      expect(player.getStemState(type)).toEqual({ type, volume: 1, muted: false, soloed: false })
    }
  })

  it('emet un changement d etat', async () => {
    const states: string[] = []
    player.on('statechange', (event) => states.push(event.state))
    await player.loadBuffers(makeStems())
    expect(states).toContain('ready')
  })
})

describe('MultitrackPlayer — demarrage synchrone', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
    await player.loadBuffers(makeStems())
  })

  it('planifie les quatre pistes sur un unique instant', async () => {
    context.currentTime = 7.5
    await player.play()

    const starts = context.liveSources.flatMap((source) => source.startCalls)
    expect(starts).toHaveLength(4)
    expect(new Set(starts.map((call) => call.when)).size).toBe(1)
    expect(starts[0]?.when).toBeCloseTo(7.5 + DEFAULT_LOOKAHEAD_SECONDS, 12)
  })

  it('ne fait pas avancer la position pendant le lookahead', async () => {
    context.currentTime = 0
    await player.play()
    expect(player.position).toBe(0)

    context.advance(DEFAULT_LOOKAHEAD_SECONDS / 2)
    expect(player.position).toBe(0)
  })

  it('fait avancer la position au rythme de l horloge audio', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 10)
    expect(player.position).toBeCloseTo(10, 9)
  })

  it('est idempotent : un second play ne replanifie rien', async () => {
    await player.play()
    const count = context.liveSources.length
    await player.play()
    expect(context.liveSources).toHaveLength(count)
  })

  it('reprend le contexte suspendu avant de planifier', async () => {
    context.state = 'suspended'
    await player.play()
    expect(context.state).toBe('running')
    expect(context.liveSources).toHaveLength(4)
  })

  it('ne planifie rien sans piste chargee', async () => {
    const empty = makePlayer(new FakeAudioContext())
    await empty.play()
    expect(empty.state).toBe('idle')
  })
})

describe('MultitrackPlayer — seek', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
    await player.loadBuffers(makeStems())
  })

  it('replanifie toutes les pistes sur un unique instant, sans derive', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 12)

    const before = context.createdSources.length
    player.seek(90)

    const fresh = context.createdSources.slice(before)
    expect(fresh).toHaveLength(4)

    const starts = fresh.flatMap((source) => source.startCalls)
    // Un seul instant de demarrage et un seul offset : c'est la definition de
    // « derive nulle » — aucune piste ne peut partir en avance ou en retard.
    expect(new Set(starts.map((call) => call.when)).size).toBe(1)
    expect(new Set(starts.map((call) => call.offset))).toEqual(new Set([90]))
  })

  it('arrete les anciennes sources', async () => {
    await player.play()
    const previous = [...context.createdSources]
    player.seek(30)
    expect(previous.every((source) => source.stopped)).toBe(true)
  })

  it('rend exactement la position demandee juste apres le seek', async () => {
    await player.play()
    context.advance(20)
    player.seek(45.75)
    expect(player.position).toBe(45.75)
  })

  it('ne cumule aucune erreur sur une serie de seeks', async () => {
    await player.play()
    for (const target of [10, 150, 3, 99.5, 42]) {
      context.advance(1)
      player.seek(target)
      expect(player.position).toBe(target)
    }
  })

  it('borne la cible aux limites du morceau', async () => {
    await player.play()
    player.seek(-50)
    expect(player.position).toBe(0)
    player.seek(TRACK_DURATION + 50)
    expect(player.position).toBe(TRACK_DURATION)
  })

  it('reste en pause si on cherche a l arret', async () => {
    await player.loadBuffers(makeStems())
    player.seek(60)
    expect(player.position).toBe(60)
    expect(context.liveSources).toHaveLength(0)
  })
})

describe('MultitrackPlayer — pause et reprise', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
    await player.loadBuffers(makeStems())
  })

  it('fige la position a la pause', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 33)
    player.pause()

    const position = player.position
    expect(position).toBeCloseTo(33, 9)

    context.advance(120)
    expect(player.position).toBe(position)
    expect(player.state).toBe('paused')
  })

  it('reprend a la position figee, toujours en un seul instant', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 33)
    player.pause()

    const resumeFrom = player.position
    const before = context.createdSources.length
    await player.play()

    const starts = context.createdSources.slice(before).flatMap((source) => source.startCalls)
    expect(starts).toHaveLength(4)
    expect(new Set(starts.map((call) => call.when)).size).toBe(1)
    for (const call of starts) {
      expect(call.offset).toBeCloseTo(resumeFrom, 9)
    }
  })

  it('ignore une pause quand rien ne joue', () => {
    player.pause()
    expect(player.state).toBe('ready')
  })

  it('remet la tete de lecture a zero sur stop', async () => {
    await player.play()
    context.advance(50)
    player.stop()
    expect(player.position).toBe(0)
    expect(player.state).toBe('ready')
  })
})

describe('MultitrackPlayer — mixage', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
    await player.loadBuffers(makeStems())
  })

  /**
   * Gain de mixage d'une piste.
   *
   * Le graphe compte deux gains par piste : celui du moteur et celui du mixage.
   * Seul le second est branche sur le master — c'est ce lien qui l'identifie, et
   * non son rang de creation, qui depend du moteur retenu.
   */
  const gainOf = (type: StemType) => {
    const master = context.createdGains[0]
    const mixGains = context.createdGains.filter(
      (gain) => gain !== master && master !== undefined && gain.connections.has(master),
    )
    return mixGains[STEM_TYPES.indexOf(type)]
  }

  it('applique le volume d une piste', () => {
    player.setVolume('vocals', 0.35)
    expect(gainOf('vocals')?.gain.target).toBeCloseTo(0.35, 9)
    expect(player.getStemState('vocals')?.volume).toBe(0.35)
  })

  it('coupe une piste mutee sans perdre son volume', () => {
    player.setVolume('drums', 0.7)
    player.setMuted('drums', true)
    expect(gainOf('drums')?.gain.target).toBe(0)
    expect(player.getStemState('drums')?.volume).toBe(0.7)

    player.setMuted('drums', false)
    expect(gainOf('drums')?.gain.target).toBeCloseTo(0.7, 9)
  })

  it('rend muettes toutes les pistes hors solo', () => {
    player.setSoloed('bass', true)
    expect(gainOf('bass')?.gain.target).toBe(1)
    for (const type of ['vocals', 'drums', 'other'] as StemType[]) {
      expect(gainOf(type)?.gain.target).toBe(0)
    }
  })

  it('retablit tout le mix quand le dernier solo est relache', () => {
    player.setSoloed('bass', true)
    player.setSoloed('bass', false)
    for (const type of STEM_TYPES) {
      expect(gainOf(type)?.gain.target).toBe(1)
    }
  })

  it('clearSolos coupe tous les solos d un coup', () => {
    player.setSoloed('bass', true)
    player.setSoloed('drums', true)
    player.clearSolos()
    for (const type of STEM_TYPES) {
      expect(gainOf(type)?.gain.target).toBe(1)
      expect(player.getStemState(type)?.soloed).toBe(false)
    }
  })

  it('bascule mute et solo', () => {
    player.toggleMute('vocals')
    expect(player.getStemState('vocals')?.muted).toBe(true)
    player.toggleSolo('vocals')
    expect(player.getStemState('vocals')?.soloed).toBe(true)
  })

  it('borne le volume maitre', () => {
    player.setMasterVolume(2)
    expect(player.masterVolume).toBe(1)
    player.setMasterVolume(-1)
    expect(player.masterVolume).toBe(0)
  })

  it('emet un evenement de mixage', () => {
    const events: number[] = []
    player.on('mixchange', (event) => events.push(event.stems.length))
    player.setVolume('vocals', 0.5)
    expect(events).toEqual([4])
  })

  it('ignore une piste inconnue', () => {
    player.setVolume('piano', 0.5)
    expect(player.getStemState('piano')).toBeUndefined()
  })
})

describe('MultitrackPlayer — fin de morceau', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
  })

  it('bascule en `ended` et se recale sur la duree', async () => {
    const context = new FakeAudioContext()
    const player = makePlayer(context)
    await player.loadBuffers(makeStems(4))

    const ended = vi.fn()
    player.on('ended', ended)

    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 4)
    await vi.advanceTimersByTimeAsync(5000)

    expect(ended).toHaveBeenCalledOnce()
    expect(player.state).toBe('ended')
    expect(player.position).toBe(4)
    vi.useRealTimers()
  })

  it('replanifie la verification si la minuterie se reveille trop tot', async () => {
    const context = new FakeAudioContext()
    const player = makePlayer(context)
    await player.loadBuffers(makeStems(10))

    const ended = vi.fn()
    player.on('ended', ended)

    await player.play()
    // L'horloge audio n'a pas avance : la minuterie doit constater qu'il reste du
    // morceau et se replanifier plutot que declarer la fin.
    await vi.advanceTimersByTimeAsync(11_000)
    expect(ended).not.toHaveBeenCalled()
    expect(player.state).toBe('playing')

    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 10)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(ended).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('repart du debut si on relance depuis la fin', async () => {
    const context = new FakeAudioContext()
    const player = makePlayer(context)
    await player.loadBuffers(makeStems(4))

    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 4)
    await vi.advanceTimersByTimeAsync(5000)
    expect(player.state).toBe('ended')

    const before = context.createdSources.length
    await player.play()
    const starts = context.createdSources.slice(before).flatMap((source) => source.startCalls)
    expect(starts).toHaveLength(4)
    expect(new Set(starts.map((call) => call.offset))).toEqual(new Set([0]))
    vi.useRealTimers()
  })
})

describe('MultitrackPlayer — cycle de vie', () => {
  it('echoue avec un message clair sans Web Audio disponible', () => {
    // Node n'expose pas AudioContext : sans contexte injecte, la construction doit
    // echouer explicitement plutot que produire un lecteur muet et silencieux.
    expect(() => new MultitrackPlayer()).toThrow(/Web Audio/)
  })

  it('refuse toute operation apres destruction', async () => {
    const context = new FakeAudioContext()
    const player = makePlayer(context)
    await player.loadBuffers(makeStems())
    player.destroy()

    expect(() => player.setVolume('vocals', 0.5)).toThrow(/detruit/)
    expect(() => player.seek(10)).toThrow(/detruit/)
  })

  it('ne ferme pas un contexte fourni de l exterieur', () => {
    const context = new FakeAudioContext()
    const player = makePlayer(context)
    player.destroy()
    expect(context.closed).toBe(false)
  })

  it('supporte une double destruction', () => {
    const context = new FakeAudioContext()
    const player = makePlayer(context)
    player.destroy()
    expect(() => player.destroy()).not.toThrow()
  })
})

describe('MultitrackPlayer — vitesse de lecture', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
    await player.loadBuffers(makeStems())
  })

  it('demarre au tempo original', () => {
    expect(player.playbackRate).toBe(1)
  })

  it('applique la vitesse aux sources deja en lecture', async () => {
    await player.play()
    player.setPlaybackRate(0.75)
    for (const source of context.liveSources) {
      expect(source.playbackRate.value).toBe(0.75)
    }
  })

  it('applique la vitesse aux sources creees ensuite', async () => {
    player.setPlaybackRate(1.25)
    await player.play()
    for (const source of context.liveSources) {
      expect(source.playbackRate.value).toBe(1.25)
    }
  })

  it('ne fait pas sauter la position au changement de vitesse', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 20)

    const before = player.position
    player.setPlaybackRate(0.5)
    // Sans reancrage, les 20 s deja ecoulees seraient relues a la nouvelle
    // vitesse et la position ferait un bond.
    expect(player.position).toBeCloseTo(before, 9)
  })

  it('fait avancer la position au rythme demande', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS)
    player.setPlaybackRate(0.5)

    context.advance(10)
    // A mi-vitesse, dix secondes d'horloge valent cinq secondes de morceau.
    expect(player.position).toBeCloseTo(5, 9)
  })

  it('borne la vitesse aux valeurs jouables', () => {
    player.setPlaybackRate(10)
    expect(player.playbackRate).toBe(1.5)
    player.setPlaybackRate(0.01)
    expect(player.playbackRate).toBe(0.5)
  })

  it('ignore une vitesse non finie', () => {
    player.setPlaybackRate(0.75)
    player.setPlaybackRate(Number.NaN)
    expect(player.playbackRate).toBe(1)
  })

  it('conserve la vitesse a la pause puis a la reprise', async () => {
    await player.play()
    player.setPlaybackRate(0.8)
    player.pause()
    expect(player.playbackRate).toBe(0.8)

    await player.play()
    expect(player.playbackRate).toBe(0.8)
    for (const source of context.liveSources) {
      expect(source.playbackRate.value).toBe(0.8)
    }
  })

  it('conserve la vitesse apres un seek', async () => {
    await player.play()
    player.setPlaybackRate(1.25)
    player.seek(42)

    expect(player.playbackRate).toBe(1.25)
    expect(player.position).toBe(42)
  })
})

describe('MultitrackPlayer — transposition', () => {
  let context: FakeAudioContext
  let player: MultitrackPlayer

  beforeEach(async () => {
    context = new FakeAudioContext()
    player = makePlayer(context)
    await player.loadBuffers(makeStems())
  })

  it('demarre sans transposition', () => {
    expect(player.semitones).toBe(0)
  })

  it('borne la transposition a une octave', () => {
    player.setSemitones(24)
    expect(player.semitones).toBe(12)
    player.setSemitones(-24)
    expect(player.semitones).toBe(-12)
  })

  it('arrondit au demi-ton', () => {
    player.setSemitones(2.4)
    expect(player.semitones).toBe(2)
  })

  it('ignore une valeur non finie', () => {
    player.setSemitones(-3)
    player.setSemitones(Number.NaN)
    expect(player.semitones).toBe(0)
  })

  it('ne touche pas a la position', async () => {
    await player.play()
    context.advance(DEFAULT_LOOKAHEAD_SECONDS + 12)

    const before = player.position
    player.setSemitones(-3)
    // La hauteur et le temps sont independants : transposer ne deplace rien.
    expect(player.position).toBeCloseTo(before, 9)
  })

  it('ne touche pas au tempo', async () => {
    player.setPlaybackRate(0.75)
    player.setSemitones(5)
    expect(player.playbackRate).toBe(0.75)
  })

  it('conserve la transposition apres un seek', async () => {
    await player.play()
    player.setSemitones(-3)
    player.seek(30)
    expect(player.semitones).toBe(-3)
  })

  it('signale que le repli ne dissocie pas hauteur et tempo', () => {
    // Le moteur injecte par les tests est celui du repli.
    expect(player.supportsIndependentPitch).toBe(false)
  })

  it('previent quand l etirement n a pas pu etre charge', async () => {
    const fallbackContext = new FakeAudioContext()
    const reasons: Error[] = []

    const instance = new MultitrackPlayer({
      context: asAudioContext(fallbackContext),
      createEngine: async (audioContext, stems, options) => {
        options?.onFallback?.(new Error('AudioWorklet indisponible'))
        return new BufferSourceEngine(audioContext, stems)
      },
    })
    instance.on('fallback', (event) => reasons.push(event.reason))
    await instance.loadBuffers(makeStems())

    expect(reasons).toHaveLength(1)
    expect(reasons[0]?.message).toMatch(/AudioWorklet/)
  })
})
