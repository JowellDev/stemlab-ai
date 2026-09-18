import { beforeEach, describe, expect, it } from 'vitest'
import { ChordPad, MAX_SMOOTHNESS, MIN_SMOOTHNESS } from '../src/pad/chord-pad.js'
import { createImpulseResponse } from '../src/pad/reverb.js'
import { VOICES, voiceById } from '../src/pad/voices.js'
import { FakeAudioContext, asAudioContext } from './fake-audio-context.js'

const DO_MAJEUR = [60, 64, 67]
const FA_MAJEUR = [65, 69, 72]

describe('ChordPad', () => {
  let context: FakeAudioContext
  let pad: ChordPad

  beforeEach(() => {
    context = new FakeAudioContext()
    pad = new ChordPad(asAudioContext(context))
  })

  it('cree un oscillateur par partiel et par note', () => {
    pad.play(DO_MAJEUR)

    const voice = voiceById('warm')
    // Plus un oscillateur pour le vibrato, que cette voix possede.
    const attendu = DO_MAJEUR.length * voice.partials.length + 1
    expect(context.liveOscillators).toHaveLength(attendu)
  })

  it('accorde la fondamentale sur la frequence de la note', () => {
    pad.play([69]) // la 4

    const frequences = context.createdOscillators.map((o) => o.frequency.value)
    expect(frequences).toContain(440)
  })

  it('retient les notes tenues', () => {
    pad.play(DO_MAJEUR)
    expect(pad.notes).toEqual(DO_MAJEUR)
  })

  it('ne redeclenche rien sur le meme accord', () => {
    pad.play(DO_MAJEUR)
    const apres = context.createdOscillators.length

    pad.play([...DO_MAJEUR])

    // Appuyer deux fois sur le meme bouton ne doit pas produire de battement.
    expect(context.createdOscillators).toHaveLength(apres)
  })

  it('recouvre l ancien accord par le nouveau', () => {
    pad.play(DO_MAJEUR)
    const premiers = new Set(context.liveOscillators)

    pad.play(FA_MAJEUR)

    // Les deux accords sonnent ensemble : c'est le fondu enchaine. Rien n'est
    // arrete a l'instant du changement.
    for (const oscillateur of premiers) expect(oscillateur.stopped).toBe(false)
    expect(context.liveOscillators.length).toBeGreaterThan(premiers.size)
  })

  it('libere les oscillateurs une fois la descente terminee', () => {
    pad.play(DO_MAJEUR)
    const premiers = [...context.liveOscillators]

    pad.play(FA_MAJEUR)
    // Au-dela de la descente de la voix, le calque precedent n'a plus lieu d'etre.
    context.advance(voiceById('warm').release + 1)
    pad.play(DO_MAJEUR)

    expect(premiers.every((o) => o.stopped)).toBe(true)
  })

  it('monte en fondu plutot que d un coup', () => {
    pad.play(DO_MAJEUR)

    const enveloppe = context.createdGains.find((gain) => gain.gain.ramps.length > 0)
    expect(enveloppe).toBeDefined()
    const [cible, instant] = enveloppe!.gain.ramps[0]!
    expect(cible).toBeGreaterThan(0)
    expect(instant).toBeCloseTo(voiceById('warm').attack, 5)
  })

  it('se tait en laissant la descente s appliquer', () => {
    pad.play(DO_MAJEUR)
    pad.stop()

    expect(pad.notes).toEqual([])
    // Le son n'est pas coupe : les oscillateurs vivent encore le temps du fondu.
    expect(context.liveOscillators.length).toBeGreaterThan(0)
  })

  it('ignore un accord vide', () => {
    pad.play([])
    expect(pad.notes).toEqual([])
    expect(context.createdOscillators).toHaveLength(0)
  })

  it('change de timbre sans attendre l accord suivant', () => {
    pad.play(DO_MAJEUR)
    const avant = context.createdOscillators.length

    pad.setVoice('organ')

    expect(pad.voice.id).toBe('organ')
    // L'accord en cours est rejoue : sinon le bouton semblerait sans effet.
    expect(context.createdOscillators.length).toBeGreaterThan(avant)
    expect(pad.notes).toEqual(DO_MAJEUR)
  })

  it('ne rejoue rien quand le timbre ne change pas', () => {
    pad.play(DO_MAJEUR)
    const avant = context.createdOscillators.length

    pad.setVoice('warm')

    expect(context.createdOscillators).toHaveLength(avant)
  })

  it('change de timbre a vide sans declencher de son', () => {
    pad.setVoice('glass')
    expect(context.createdOscillators).toHaveLength(0)
  })

  it('borne le volume', () => {
    pad.setVolume(5)
    expect(context.createdGains[0]!.gain.target).toBe(1)

    pad.setVolume(-1)
    expect(context.createdGains[0]!.gain.target).toBe(0)
  })

  it('borne la douceur', () => {
    pad.setSmoothness(100)
    pad.play(DO_MAJEUR)

    const enveloppe = context.createdGains.find((gain) => gain.gain.ramps.length > 0)
    const [, instant] = enveloppe!.gain.ramps[0]!
    expect(instant).toBeCloseTo(voiceById('warm').attack * MAX_SMOOTHNESS, 5)
  })

  it('raccourcit l attaque quand la douceur baisse', () => {
    pad.setSmoothness(MIN_SMOOTHNESS)
    pad.play(DO_MAJEUR)

    const enveloppe = context.createdGains.find((gain) => gain.gain.ramps.length > 0)
    const [, instant] = enveloppe!.gain.ramps[0]!
    expect(instant).toBeCloseTo(voiceById('warm').attack * MIN_SMOOTHNESS, 5)
  })

  it('arrete tout a la destruction', () => {
    pad.play(DO_MAJEUR)
    pad.dispose()

    expect(context.liveOscillators).toHaveLength(0)
    expect(pad.notes).toEqual([])
  })

  it('ne joue plus rien apres destruction', () => {
    pad.dispose()
    pad.play(DO_MAJEUR)

    expect(context.createdOscillators).toHaveLength(0)
  })
})

describe('voix', () => {
  it('retombe sur la premiere voix pour un identifiant inconnu', () => {
    expect(voiceById('inexistante').id).toBe(VOICES[0]!.id)
  })

  it('donne un nom et une description a chaque voix', () => {
    for (const voice of VOICES) {
      expect(voice.name.length, voice.id).toBeGreaterThan(0)
      expect(voice.description.length, voice.id).toBeGreaterThan(0)
    }
  })

  it('garde des identifiants uniques', () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length)
  })

  it('donne a chaque voix au moins un partiel et une attaque', () => {
    for (const voice of VOICES) {
      expect(voice.partials.length, voice.id).toBeGreaterThan(0)
      expect(voice.attack, voice.id).toBeGreaterThan(0)
      expect(voice.release, voice.id).toBeGreaterThan(0)
    }
  })
})

describe('reverberation', () => {
  it('produit une queue stereo de la duree demandee', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, { seconds: 2 })

    expect(buffer.numberOfChannels).toBe(2)
    expect(buffer.length).toBe(context.sampleRate * 2)
  })

  it('decroit du debut vers la fin', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, { seconds: 1 })
    const data = buffer.getChannelData(0)

    const energie = (from: number, to: number) => {
      let somme = 0
      for (let i = from; i < to; i++) somme += Math.abs(data[i]!)
      return somme / (to - from)
    }

    // Une queue de reverberation qui ne decroit pas n'est pas une reverberation.
    expect(energie(1000, 5000)).toBeGreaterThan(energie(data.length - 5000, data.length))
  })

  it('ouvre l attaque au lieu de la faire claquer', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, { seconds: 1 })
    const data = buffer.getChannelData(0)

    expect(Math.abs(data[0]!)).toBeLessThan(0.05)
  })
})
