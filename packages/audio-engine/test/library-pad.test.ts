import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CROSSFADE, LibraryPad, MAX_CROSSFADE, MIN_CROSSFADE } from '../src/pad/library-pad.js'
import { FakeAudioBuffer, FakeAudioContext, asAudioBuffer, asAudioContext } from './fake-audio-context.js'

const FA_MAJEUR = '5-major'
const LA_MINEUR = '9-minor'

describe('LibraryPad', () => {
  let context: FakeAudioContext
  let pad: LibraryPad

  const nappe = () => asAudioBuffer(new FakeAudioBuffer(37, 44_100, 2))

  beforeEach(() => {
    context = new FakeAudioContext()
    pad = new LibraryPad(asAudioContext(context))
    pad.add(FA_MAJEUR, nappe())
    pad.add(LA_MINEUR, nappe())
  })

  it('annonce les tonalites disponibles', () => {
    expect(pad.available.sort()).toEqual([FA_MAJEUR, LA_MINEUR].sort())
    expect(pad.has(FA_MAJEUR)).toBe(true)
    expect(pad.has('0-major')).toBe(false)
  })

  it('joue la nappe d une tonalite, en boucle', () => {
    expect(pad.play(FA_MAJEUR)).toBe(true)

    const source = context.createdSources.at(-1)!
    // Une nappe qui s'arrete au bout de trente secondes n'en est pas une.
    expect(source.loop).toBe(true)
    expect(source.startCalls).toHaveLength(1)
    expect(pad.current).toBe(FA_MAJEUR)
  })

  it('refuse une tonalite sans fichier, sans couper ce qui sonne', () => {
    pad.play(FA_MAJEUR)

    expect(pad.play('0-major')).toBe(false)
    // Mieux vaut garder la nappe precedente que laisser un silence.
    expect(pad.current).toBe(FA_MAJEUR)
    expect(context.liveSources).toHaveLength(1)
  })

  it('ne relance rien sur la tonalite en cours', () => {
    pad.play(FA_MAJEUR)
    const avant = context.createdSources.length

    pad.play(FA_MAJEUR)

    expect(context.createdSources).toHaveLength(avant)
  })

  it('recouvre l ancienne nappe par la nouvelle', () => {
    pad.play(FA_MAJEUR)
    const premiere = context.createdSources.at(-1)!

    pad.play(LA_MINEUR)

    // Les deux sonnent ensemble pendant le fondu : rien n'est coupe net.
    expect(premiere.stopped).toBe(false)
    expect(context.liveSources).toHaveLength(2)
    expect(pad.current).toBe(LA_MINEUR)
  })

  it('libere la nappe precedente une fois le fondu termine', () => {
    pad.play(FA_MAJEUR)
    const premiere = context.createdSources.at(-1)!

    pad.play(LA_MINEUR)
    context.advance(DEFAULT_CROSSFADE + 1)
    pad.play(FA_MAJEUR)

    expect(premiere.stopped).toBe(true)
  })

  it('monte en fondu plutot que d un coup', () => {
    pad.play(FA_MAJEUR)

    const enveloppe = context.createdGains.find((gain) => gain.gain.ramps.length > 0)!
    const [cible, instant] = enveloppe.gain.ramps[0]!
    expect(cible).toBe(1)
    expect(instant).toBeCloseTo(DEFAULT_CROSSFADE, 5)
  })

  it('suit la duree de fondu demandee', () => {
    pad.setCrossfade(8)
    pad.play(FA_MAJEUR)

    const enveloppe = context.createdGains.find((gain) => gain.gain.ramps.length > 0)!
    expect(enveloppe.gain.ramps[0]![1]).toBeCloseTo(8, 5)
  })

  it('borne la duree de fondu', () => {
    pad.setCrossfade(1000)
    pad.play(FA_MAJEUR)
    const long = context.createdGains.find((g) => g.gain.ramps.length > 0)!
    expect(long.gain.ramps[0]![1]).toBeCloseTo(MAX_CROSSFADE, 5)

    const autre = new LibraryPad(asAudioContext(context), { crossfade: 0 })
    autre.add(FA_MAJEUR, nappe())
    const avant = context.createdGains.length
    autre.play(FA_MAJEUR)
    const court = context.createdGains.slice(avant).find((g) => g.gain.ramps.length > 0)!
    expect(court.gain.ramps[0]![1]).toBeCloseTo(MIN_CROSSFADE, 5)
  })

  it('se tait en laissant le fondu s appliquer', () => {
    pad.play(FA_MAJEUR)
    pad.stop()

    expect(pad.current).toBeNull()
    // Le son n'est pas coupe : la source vit encore le temps du fondu.
    expect(context.liveSources).toHaveLength(1)
  })

  it('retirer la tonalite en cours l arrete', () => {
    pad.play(FA_MAJEUR)
    pad.remove(FA_MAJEUR)

    expect(pad.has(FA_MAJEUR)).toBe(false)
    expect(pad.current).toBeNull()
  })

  it('retirer une autre tonalite ne coupe rien', () => {
    pad.play(FA_MAJEUR)
    pad.remove(LA_MINEUR)

    expect(pad.current).toBe(FA_MAJEUR)
  })

  it('borne le volume', () => {
    pad.setVolume(5)
    expect(context.createdGains[0]!.gain.target).toBe(1)
    pad.setVolume(-1)
    expect(context.createdGains[0]!.gain.target).toBe(0)
  })

  it('arrete tout a la destruction', () => {
    pad.play(FA_MAJEUR)
    pad.dispose()

    expect(context.liveSources).toHaveLength(0)
    expect(pad.current).toBeNull()
    expect(pad.available).toEqual([])
  })

  it('ne joue plus rien apres destruction', () => {
    pad.dispose()
    expect(pad.play(FA_MAJEUR)).toBe(false)
  })
})
