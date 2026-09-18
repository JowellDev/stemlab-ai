import type { Beat, Chord, TimeSignature } from '@stemlab/contracts'
import { describe, expect, it } from 'vitest'
import { assignChordsToBars, barIndexAt, buildBars } from '../src/bars.js'

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 }

/** Huit temps a 120 BPM : deux mesures de quatre temps. */
function beats(count = 8, step = 0.5, phase = 0): Beat[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index * step,
    position: (((index - phase) % 4) + 4) % 4 === 0 ? 1 : ((((index - phase) % 4) + 4) % 4) + 1,
  }))
}

describe('buildBars', () => {
  it('decoupe sur les temps forts', () => {
    const bars = buildBars(beats(), FOUR_FOUR, 4)
    expect(bars).toHaveLength(2)
    expect(bars[0]).toMatchObject({ number: 1, start: 0, end: 2 })
    expect(bars[1]).toMatchObject({ number: 2, start: 2, end: 4 })
  })

  it('rattache les temps a leur mesure', () => {
    const bars = buildBars(beats(), FOUR_FOUR, 4)
    expect(bars[0]?.beats).toEqual([0, 0.5, 1, 1.5])
    expect(bars[1]?.beats).toEqual([2, 2.5, 3, 3.5])
  })

  it('la derniere mesure va jusqu a la fin du morceau', () => {
    // Le dernier temps fort n'est pas suivi d'un autre : la mesure s'etend
    // jusqu'a la duree connue, plutot que de s'arreter au dernier temps.
    const bars = buildBars(beats(), FOUR_FOUR, 4.8)
    expect(bars.at(-1)?.end).toBe(4.8)
  })

  it('suit une levee', () => {
    const withPickup = beats(9, 0.5, 1)
    const bars = buildBars(withPickup, FOUR_FOUR, 4.5)
    expect(bars[0]?.start).toBe(0.5)
  })

  it('retombe sur un decoupage mecanique sans temps fort', () => {
    const noDownbeats: Beat[] = beats().map((beat) => ({ ...beat, position: 2 }))
    const bars = buildBars(noDownbeats, FOUR_FOUR, 4)
    expect(bars).toHaveLength(2)
  })

  it('rend une grille vide sans temps', () => {
    expect(buildBars([], FOUR_FOUR, 10)).toEqual([])
  })

  it('supporte une autre signature', () => {
    const waltz = Array.from({ length: 6 }, (_, index) => ({
      time: index * 0.5,
      position: (index % 3) + 1,
    }))
    const bars = buildBars(waltz, { numerator: 3, denominator: 4 }, 3)
    expect(bars).toHaveLength(2)
    expect(bars[0]?.beats).toHaveLength(3)
  })
})

describe('assignChordsToBars', () => {
  const chord = (start: number, end: number, label: string): Chord => ({
    start,
    end,
    label,
    root: 0,
    quality: '',
    confidence: 0.9,
  })

  const bars = buildBars(beats(), FOUR_FOUR, 4)

  it('place un accord par mesure', () => {
    const filled = assignChordsToBars(bars, [chord(0, 2, 'Am'), chord(2, 4, 'F')])
    expect(filled[0]?.chords.map((c) => c.chord.label)).toEqual(['Am'])
    expect(filled[1]?.chords.map((c) => c.chord.label)).toEqual(['F'])
  })

  it('occupe toute la largeur quand l accord couvre la mesure', () => {
    const filled = assignChordsToBars(bars, [chord(0, 2, 'Am')])
    expect(filled[0]?.chords[0]).toMatchObject({ offset: 0, width: 1 })
  })

  it('repartit deux accords dans une meme mesure', () => {
    const filled = assignChordsToBars(bars, [chord(0, 1, 'Am'), chord(1, 2, 'F')])
    expect(filled[0]?.chords).toHaveLength(2)
    expect(filled[0]?.chords[0]).toMatchObject({ offset: 0, width: 0.5 })
    expect(filled[0]?.chords[1]).toMatchObject({ offset: 0.5, width: 0.5 })
  })

  it('tronque un accord qui deborde sur deux mesures', () => {
    // Une grille se lit mesure par mesure : l'accord apparait dans les deux.
    const filled = assignChordsToBars(bars, [chord(1, 3, 'Am')])
    expect(filled[0]?.chords[0]).toMatchObject({ offset: 0.5, width: 0.5 })
    expect(filled[1]?.chords[0]).toMatchObject({ offset: 0, width: 0.5 })
  })

  it('laisse une mesure vide sans accord', () => {
    expect(assignChordsToBars(bars, [chord(2, 4, 'F')])[0]?.chords).toEqual([])
  })
})

describe('barIndexAt', () => {
  const bars = buildBars(beats(), FOUR_FOUR, 4)

  it('trouve la mesure courante', () => {
    expect(barIndexAt(bars, 0)).toBe(0)
    expect(barIndexAt(bars, 1.9)).toBe(0)
    expect(barIndexAt(bars, 2)).toBe(1)
  })

  it('rend -1 hors de la grille', () => {
    expect(barIndexAt(bars, 10)).toBe(-1)
  })
})
