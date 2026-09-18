import type { Beat, Chord } from '@stemlab/contracts'
import { describe, expect, it } from 'vitest'
import { beatAt, beatIndexAt, chordAt, chordIndexAt, indexAt } from '../src/lookup.js'

const chord = (start: number, end: number, label: string): Chord => ({
  start,
  end,
  label,
  root: 0,
  quality: '',
  confidence: 0.9,
})

const PROGRESSION = [chord(0, 2, 'Am'), chord(2, 4, 'F'), chord(4, 6, 'C'), chord(6, 8, 'G')]

describe('chordIndexAt', () => {
  it.each([
    [0, 0],
    [1.99, 0],
    [2, 1],
    [5, 2],
    [7.999, 3],
  ])('a %s s rend l index %s', (time, expected) => {
    expect(chordIndexAt(PROGRESSION, time)).toBe(expected)
  })

  it('rend -1 hors de la suite', () => {
    expect(chordIndexAt(PROGRESSION, -1)).toBe(-1)
    expect(chordIndexAt(PROGRESSION, 8)).toBe(-1)
    expect(chordIndexAt([], 1)).toBe(-1)
  })

  it('la borne de fin appartient a l accord suivant', () => {
    // Sans cette convention, deux accords seraient actifs au meme instant.
    expect(chordAt(PROGRESSION, 2)?.label).toBe('F')
  })

  it('trouve le bon accord sur une longue suite', () => {
    const long = Array.from({ length: 1000 }, (_, i) => chord(i, i + 1, `c${i}`))
    expect(chordAt(long, 742.5)?.label).toBe('c742')
    expect(chordAt(long, 0)?.label).toBe('c0')
    expect(chordAt(long, 999.9)?.label).toBe('c999')
  })

  it('supporte un trou dans la suite', () => {
    const holed = [chord(0, 1, 'A'), chord(3, 4, 'B')]
    expect(chordAt(holed, 2)).toBeNull()
    expect(chordAt(holed, 3.5)?.label).toBe('B')
  })
})

describe('beatIndexAt', () => {
  const beats: Beat[] = [0, 0.5, 1, 1.5, 2].map((time, index) => ({
    time,
    position: (index % 4) + 1,
  }))

  it.each([
    [0, 0],
    [0.4, 0],
    [0.5, 1],
    [1.9, 3],
    [10, 4],
  ])('a %s s rend l index %s', (time, expected) => {
    expect(beatIndexAt(beats, time)).toBe(expected)
  })

  it('rend -1 avant le premier temps', () => {
    expect(beatIndexAt(beats, -0.1)).toBe(-1)
    expect(beatAt(beats, -0.1)).toBeNull()
  })

  it('rend le temps lui-meme', () => {
    expect(beatAt(beats, 1.2)).toEqual({ time: 1, position: 3 })
  })

  it('supporte une liste vide', () => {
    expect(beatIndexAt([], 1)).toBe(-1)
  })
})

describe('indexAt', () => {
  it('fonctionne sur n importe quel intervalle', () => {
    const spans = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ]
    expect(indexAt(spans, 15)).toBe(1)
    expect(indexAt(spans, 25)).toBe(-1)
  })
})
