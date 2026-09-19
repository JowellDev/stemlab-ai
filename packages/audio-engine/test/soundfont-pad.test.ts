import { beforeEach, describe, expect, it } from 'vitest'
import { SoundFontPad, type SoundFontSynthesizer } from '../src/pad/soundfont-pad.js'
import { FakeAudioContext, asAudioContext } from './fake-audio-context.js'

/** Synthetiseur factice : on observe les messages MIDI, seule chose qui sorte de la classe. */
class FakeSynth implements SoundFontSynthesizer {
  readonly isReady = Promise.resolve()
  readonly soundBankManager = { addSoundBank: async () => undefined }
  readonly messages: string[] = []
  readonly destinations = new Set<AudioNode>()
  disconnected = false

  connect(destination: AudioNode): AudioNode {
    this.destinations.add(destination)
    return destination
  }

  disconnect(): undefined {
    this.disconnected = true
    return undefined
  }

  programChange(channel: number, program: number): void {
    this.messages.push(`program ${channel}:${program}`)
  }

  noteOn(_channel: number, note: number, velocity: number): void {
    this.messages.push(`on ${note}@${velocity}`)
  }

  noteOff(_channel: number, note: number): void {
    this.messages.push(`off ${note}`)
  }

  /** Notes actuellement tenues, reconstituees depuis les messages. */
  get held(): number[] {
    const tenues = new Set<number>()
    for (const message of this.messages) {
      const [type, reste] = message.split(' ')
      if (type === 'on') tenues.add(Number(reste!.split('@')[0]))
      if (type === 'off') tenues.delete(Number(reste))
    }
    return [...tenues].sort((a, b) => a - b)
  }
}

const DO_MAJEUR = [48, 60, 64, 67]
const FA_MAJEUR = [53, 60, 65, 69]

describe('SoundFontPad', () => {
  let context: FakeAudioContext
  let synth: FakeSynth
  let pad: SoundFontPad

  beforeEach(() => {
    context = new FakeAudioContext()
    synth = new FakeSynth()
    pad = new SoundFontPad(asAudioContext(context), synth, { program: 89 })
  })

  it('choisit le programme demande des la construction', () => {
    expect(synth.messages[0]).toBe('program 0:89')
    expect(pad.program).toBe(89)
  })

  it('alimente le son direct, la salle et l echo', () => {
    // Trois entrees distinctes : sans cela, la nappe ne serait ni spatialisee
    // ni prolongee.
    expect(synth.destinations.size).toBe(3)
  })

  it('tient les notes de l accord', () => {
    pad.play(DO_MAJEUR)

    expect(synth.held).toEqual([...DO_MAJEUR].sort((a, b) => a - b))
    expect(pad.notes).toEqual(DO_MAJEUR)
  })

  it('ne relance pas les notes communes a l accord suivant', () => {
    pad.play(DO_MAJEUR)
    synth.messages.length = 0

    pad.play(FA_MAJEUR)

    // Le 60 est dans les deux accords : le reattaquer s'entendrait comme un accroc.
    expect(synth.messages).not.toContain('on 60@96')
    expect(synth.messages).toContain('off 48')
    expect(synth.messages).toContain('on 53@96')
  })

  it('relache les notes qui disparaissent', () => {
    pad.play(DO_MAJEUR)
    pad.play(FA_MAJEUR)

    expect(synth.held).toEqual([...FA_MAJEUR].sort((a, b) => a - b))
  })

  it('se tait entierement', () => {
    pad.play(DO_MAJEUR)
    pad.stop()

    expect(synth.held).toEqual([])
    expect(pad.notes).toEqual([])
  })

  it('ignore un accord vide', () => {
    pad.play([])
    expect(pad.notes).toEqual([])
  })

  it('change de programme en relancant l accord tenu', () => {
    pad.play(DO_MAJEUR)
    synth.messages.length = 0

    pad.setProgram(91)

    expect(synth.messages).toContain('program 0:91')
    expect(synth.held).toEqual([...DO_MAJEUR].sort((a, b) => a - b))
    expect(pad.program).toBe(91)
  })

  it('ne fait rien quand le programme ne change pas', () => {
    pad.play(DO_MAJEUR)
    synth.messages.length = 0

    pad.setProgram(89)

    expect(synth.messages).toEqual([])
  })

  it('change de programme a vide sans declencher de note', () => {
    pad.setProgram(91)
    expect(synth.held).toEqual([])
  })

  it('le timbre ne change que les effets', () => {
    pad.play(DO_MAJEUR)
    synth.messages.length = 0

    pad.setVoice('glass')

    // La source est echantillonnee : le timbre n'emprunte que la salle et l'echo.
    // Aucun message MIDI n'est emis, et l'accord reste tenu.
    expect(pad.voice.id).toBe('glass')
    expect(synth.messages).toEqual([])
    expect(pad.notes).toEqual(DO_MAJEUR)
  })

  it('coupe tout a la destruction', () => {
    pad.play(DO_MAJEUR)
    pad.dispose()

    expect(synth.held).toEqual([])
    expect(synth.disconnected).toBe(true)
  })

  it('ne joue plus rien apres destruction', () => {
    pad.dispose()
    synth.messages.length = 0

    pad.play(DO_MAJEUR)

    expect(synth.messages).toEqual([])
  })
})
