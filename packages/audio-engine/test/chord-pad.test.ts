import { beforeEach, describe, expect, it } from 'vitest'
import { ChordPad, MAX_SMOOTHNESS, MIN_SMOOTHNESS } from '../src/pad/chord-pad.js'
import { createDriveCurve, createImpulseResponse } from '../src/pad/reverb.js'
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

  it('cree un oscillateur par voix d unisson et par note', () => {
    pad.play(DO_MAJEUR)

    const voice = voiceById('warm')
    const parNote = voice.layers.reduce(
      // Chaque oscillateur derivant s'accompagne du sien, qui pilote sa derive.
      (total, layer) => total + layer.unison * (layer.drift ? 2 : 1),
      0,
    )
    const attendu = DO_MAJEUR.length * parNote
    const modulation = context.liveOscillators.length - attendu

    expect(context.liveOscillators.length).toBeGreaterThanOrEqual(attendu)
    // Le reste module le filtre et l'ensemble : trois oscillateurs au plus.
    expect(modulation).toBeLessThanOrEqual(3)
  })

  it('repartit l unisson dans l espace', () => {
    pad.play([60])

    const positions = context.createdPanners.map((panner) => panner.pan.value)
    // Un unisson qui reste au centre s'entend epais, pas large.
    expect(Math.min(...positions)).toBeLessThan(0)
    expect(Math.max(...positions)).toBeGreaterThan(0)
  })

  it('module le retard de l ensemble des deux cotes', () => {
    pad.play(DO_MAJEUR)

    expect(context.createdDelays.length).toBeGreaterThanOrEqual(2)
    // Les deux branches sont en opposition : c'est de cet ecart que vient la largeur.
    const panoramiques = context.createdPanners.map((p) => p.pan.value)
    expect(panoramiques.some((value) => value <= -0.5)).toBe(true)
    expect(panoramiques.some((value) => value >= 0.5)).toBe(true)
  })

  it('accorde la strate fondamentale sur la frequence de la note', () => {
    pad.play([69]) // la 4

    const frequences = context.createdOscillators.map((o) => o.frequency.value)
    expect(frequences).toContain(440)
    // Une sous-octave soutient l'accord : sans elle, la nappe flotte.
    expect(frequences).toContain(220)
  })

  it('desaccorde les voix d unisson autour de la note', () => {
    pad.play([69])

    const desaccords = context.createdOscillators
      .filter((o) => o.frequency.value === 440)
      .map((o) => o.detune.value)

    expect(desaccords.length).toBeGreaterThan(1)
    expect(Math.min(...desaccords)).toBeLessThan(0)
    expect(Math.max(...desaccords)).toBeGreaterThan(0)
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

  it('donne a chaque voix au moins une strate et une attaque', () => {
    for (const voice of VOICES) {
      expect(voice.layers.length, voice.id).toBeGreaterThan(0)
      expect(voice.attack, voice.id).toBeGreaterThan(0)
      expect(voice.release, voice.id).toBeGreaterThan(0)
    }
  })

  it('borne l unisson et la largeur de chaque strate', () => {
    for (const voice of VOICES) {
      for (const layer of voice.layers) {
        expect(layer.unison, voice.id).toBeGreaterThanOrEqual(1)
        expect(layer.unison, voice.id).toBeLessThanOrEqual(7)
        expect(layer.spread, voice.id).toBeGreaterThanOrEqual(0)
        expect(layer.spread, voice.id).toBeLessThanOrEqual(1)
      }
    }
  })

  it('donne du mouvement a toutes les voix sauf l orgue', () => {
    // Un orgue immobile est juste ; une nappe immobile s'entend comme un
    // echantillon tenu.
    for (const voice of VOICES) {
      if (voice.id === 'organ') continue
      const bouge = voice.filter.lfoDepth > 0 || voice.layers.some((layer) => layer.drift)
      expect(bouge, voice.id).toBe(true)
    }
  })
})

describe('reverberation', () => {
  it('produit une queue stereo de la duree demandee', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, {
      seconds: 2,
      preDelay: 0,
    })

    expect(buffer.numberOfChannels).toBe(2)
    expect(buffer.length).toBe(context.sampleRate * 2)
  })

  it('ajoute le pre-delai a la duree', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, {
      seconds: 2,
      preDelay: 0.05,
    })

    // La queue garde sa duree : le pre-delai s'ajoute devant, il ne la rogne pas.
    expect(buffer.length).toBe(Math.floor(context.sampleRate * 2.05))
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


describe('saturation', () => {
  it('reste transparente a zero', () => {
    const curve = createDriveCurve(0)
    expect(curve[0]).toBeCloseTo(-1, 5)
    expect(curve[curve.length - 1]).toBeCloseTo(1, 5)
    expect(curve[Math.floor(curve.length / 2)]).toBeCloseTo(0, 2)
  })

  it('comprime les pics sans les couper', () => {
    const curve = createDriveCurve(0.5)
    const milieu = Math.floor(curve.length / 2)

    // Le signal faible est amplifie, le fort reste borne : c'est ce qui epaissit
    // sans distordre.
    expect(curve[milieu + 100]!).toBeGreaterThan((100 / milieu) * 0.9)
    expect(Math.abs(curve[curve.length - 1]!)).toBeLessThanOrEqual(1.0001)
  })

  it('reste monotone', () => {
    const curve = createDriveCurve(0.8)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!)
    }
  })
})

describe('pre-delai de la reverberation', () => {
  it('laisse un silence avant la premiere reflexion', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, {
      seconds: 1,
      preDelay: 0.05,
    })
    const data = buffer.getChannelData(0)
    const silence = Math.floor(context.sampleRate * 0.05)

    // C'est ce silence qui place la salle a distance au lieu de noyer l'attaque.
    for (let i = 0; i < silence; i++) expect(data[i]).toBe(0)
    expect(Math.abs(data[silence + 2000]!)).toBeGreaterThan(0)
  })

  it('decorrele les deux canaux', () => {
    const context = new FakeAudioContext()
    const buffer = createImpulseResponse(context as unknown as BaseAudioContext, { seconds: 1 })

    // Deux canaux identiques s'entendraient au centre, pas autour de l'auditeur.
    expect(buffer.getChannelData(0)[5000]).not.toBe(buffer.getChannelData(1)[5000])
  })
})
