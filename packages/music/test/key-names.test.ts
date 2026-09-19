import { describe, expect, it } from 'vitest'
import { keyId, parseKeyFromName } from '../src/key-names.js'

describe('parseKeyFromName', () => {
  const cas: Array<[string, number, string]> = [
    ['C.wav', 0, 'major'],
    ['Pad - F# Major.mp3', 6, 'major'],
    ['Ambient_Bbm_loop.wav', 10, 'minor'],
    ['05 - E minor.aif', 4, 'minor'],
    ['Warmth Db.flac', 1, 'major'],
    ['pad-a-minor.wav', 9, 'minor'],
    ['Eb Major Pad.ogg', 3, 'major'],
    ['G♯m ambient.wav', 8, 'minor'],
    ['Dwell_Amaj.wav', 9, 'major'],
    // Noms reels de bibliotheques de nappes, tels qu'ils arrivent.
    ['ambient-chords-pads-calming-soothing_F_major.wav', 5, 'major'],
    ['heavenly-trap-chords-pads-dreamy_70bpm_F_major.wav', 5, 'major'],
  ]

  for (const [nom, root, mode] of cas) {
    it(`lit « ${nom} »`, () => {
      expect(parseKeyFromName(nom)).toEqual({ root, mode })
    })
  }

  it('ne lit pas le b du nom comme un bemol', () => {
    // `Bb_pad.wav` : le `b` de `pad` ne doit pas alterer la note.
    expect(parseKeyFromName('Bb_pad.wav')).toEqual({ root: 10, mode: 'major' })
    expect(parseKeyFromName('B_pad.wav')).toEqual({ root: 11, mode: 'major' })
  })

  it('prefere le majeur explicite a un m isole', () => {
    expect(parseKeyFromName('A Major mellow.wav')).toEqual({ root: 9, mode: 'major' })
  })

  it('ignore une lettre prise dans un mot', () => {
    // `Grand` commence par G, mais ce n'est pas une tonalite.
    expect(parseKeyFromName('Grandiose.wav')).toBeNull()
  })

  it('rend null quand rien n est reconnaissable', () => {
    expect(parseKeyFromName('nappe-01.wav')).toBeNull()
    expect(parseKeyFromName('')).toBeNull()
  })

  it('choisit le majeur par defaut', () => {
    // Beaucoup de bibliotheques ne precisent pas le mode : une nappe tenue est
    // souvent jouable dans les deux, et le majeur est le cas le plus courant.
    expect(parseKeyFromName('D.wav')?.mode).toBe('major')
  })
})

describe('keyId', () => {
  it('produit un identifiant stable', () => {
    expect(keyId(7, 'major')).toBe('7-major')
    expect(keyId(9, 'minor')).toBe('9-minor')
  })

  it('ramene les valeurs hors bornes dans l octave', () => {
    expect(keyId(12, 'major')).toBe('0-major')
    expect(keyId(-1, 'minor')).toBe('11-minor')
  })
})
