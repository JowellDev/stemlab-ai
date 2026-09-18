import type { Chord } from '@stemlab/contracts'
import { describe, expect, it } from 'vitest'
import {
  MAX_SEMITONES,
  MIN_SEMITONES,
  clampSemitones,
  transposeChordLabel,
  transposeChords,
  transposeKey,
} from '../src/transpose.js'

const chord = (root: number | null, quality: string, label: string): Chord => ({
  start: 0,
  end: 2,
  label,
  root,
  quality,
  confidence: 0.9,
})

describe('clampSemitones', () => {
  it.each([
    [0, 0],
    [7, 7],
    [-7, -7],
    [12, 12],
    [-12, -12],
    [13, MAX_SEMITONES],
    [-30, MIN_SEMITONES],
    [2.4, 2],
    [Number.NaN, 0],
  ])('borne %s a %s', (input, expected) => {
    expect(clampSemitones(input)).toBe(expected)
  })
})

describe('transposeChordLabel', () => {
  it('ne change rien a zero demi-ton', () => {
    expect(transposeChordLabel(chord(9, 'm', 'Am'), 0)).toBe('Am')
  })

  it('monte d un demi-ton', () => {
    expect(transposeChordLabel(chord(9, 'm', 'Am'), 1)).toBe('A#m')
  })

  it('descend d un demi-ton', () => {
    expect(transposeChordLabel(chord(0, '', 'C'), -1)).toBe('B')
  })

  it('boucle sur l octave', () => {
    expect(transposeChordLabel(chord(11, '', 'B'), 1)).toBe('C')
    expect(transposeChordLabel(chord(0, '', 'C'), -13)).toBe('B')
  })

  it('conserve la qualite', () => {
    expect(transposeChordLabel(chord(2, 'maj7', 'Dmaj7'), 2)).toBe('Emaj7')
    expect(transposeChordLabel(chord(7, '7', 'G7'), 5)).toBe('C7')
  })

  it('ecrit en bemols quand on le demande', () => {
    expect(transposeChordLabel(chord(9, 'm', 'Am'), 1, 'flat')).toBe('Bbm')
    expect(transposeChordLabel(chord(4, '', 'E'), 1, 'flat')).toBe('F')
  })

  it('laisse intact un segment sans accord', () => {
    // « N » note l'absence d'accord : elle n'a pas de fondamentale a decaler.
    expect(transposeChordLabel(chord(null, '', 'N'), 5)).toBe('N')
  })

  it('douze demi-tons ramenent au meme libelle', () => {
    for (let root = 0; root < 12; root += 1) {
      const source = chord(root, 'm7', 'x')
      expect(transposeChordLabel(source, 12)).toBe(transposeChordLabel(source, 0))
    }
  })
})

describe('transposeChords', () => {
  const progression = [chord(9, 'm', 'Am'), chord(5, '', 'F'), chord(0, '', 'C')]

  it('transpose toute la suite', () => {
    expect(transposeChords(progression, 2).map((c) => c.label)).toEqual(['Bm', 'G', 'D'])
  })

  it('conserve les bornes temporelles', () => {
    const chords: Chord[] = [
      { ...chord(9, 'm', 'Am'), start: 0, end: 2 },
      { ...chord(5, '', 'F'), start: 2, end: 4 },
    ]
    const transposed = transposeChords(chords, 3)
    expect(transposed.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [2, 4],
    ])
  })

  it('met a jour la fondamentale', () => {
    expect(transposeChords([chord(9, 'm', 'Am')], 1)[0]?.root).toBe(10)
  })

  it('rend une copie a zero demi-ton', () => {
    const result = transposeChords(progression, 0)
    expect(result).toEqual(progression)
    expect(result).not.toBe(progression)
  })
})

describe('transposeKey', () => {
  it('transpose la tonique et garde le mode', () => {
    expect(transposeKey(9, 'minor', 2)).toEqual({
      root: 11,
      name: 'B',
      mode: 'minor',
      label: 'B mineur',
    })
  })

  it('choisit les bemols pour une armure en bemols', () => {
    // Fa majeur s'ecrit avec un bemol : son relatif doit suivre.
    expect(transposeKey(0, 'major', 5).name).toBe('F')
    expect(transposeKey(0, 'major', 10).name).toBe('Bb')
  })

  it('choisit les dieses pour une armure en dieses', () => {
    expect(transposeKey(0, 'major', 6).name).toBe('F#')
  })

  it('libelle le mode en francais', () => {
    expect(transposeKey(0, 'major', 0).label).toBe('C majeur')
    expect(transposeKey(9, 'minor', 0).label).toBe('A mineur')
  })

  it('boucle sur l octave', () => {
    expect(transposeKey(0, 'major', 12)).toEqual(transposeKey(0, 'major', 0))
  })
})
