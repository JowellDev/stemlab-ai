import type { Beat, Chord, TimeSignature } from '@stemlab/contracts'
import { indexAt } from './lookup.js'

/**
 * Construction de la grille de mesures.
 *
 * Une mesure va d'un temps fort au suivant. Les temps viennent de l'analyse et ne
 * sont pas parfaitement reguliers : la grille suit donc les temps detectes plutot
 * qu'un decoupage calcule a partir du tempo moyen, qui deriverait sur la longueur
 * d'un morceau.
 */

export interface Bar {
  /** Numero de mesure, 1-indexe. */
  readonly number: number
  readonly start: number
  readonly end: number
  /** Instants des temps de cette mesure. */
  readonly beats: readonly number[]
}

export interface BarChord {
  readonly chord: Chord
  /** Part de la mesure occupee par l'accord, dans [0, 1]. */
  readonly width: number
  /** Decalage depuis le debut de la mesure, dans [0, 1]. */
  readonly offset: number
}

export interface BarWithChords extends Bar {
  readonly chords: readonly BarChord[]
}

export function buildBars(
  beats: readonly Beat[],
  timeSignature: TimeSignature,
  duration: number,
): Bar[] {
  if (beats.length === 0) return []

  const perBar = Math.max(1, timeSignature.numerator)
  const downbeats: number[] = []
  for (const [index, beat] of beats.entries()) {
    if (beat.position === 1) downbeats.push(index)
  }

  // Sans temps fort identifie, on decoupe mecaniquement toutes les `numerator`
  // pulsations : mieux vaut une grille approximative que pas de grille.
  const starts =
    downbeats.length > 0
      ? downbeats
      : beats.map((_, index) => index).filter((index) => index % perBar === 0)

  const bars: Bar[] = []
  for (const [order, startIndex] of starts.entries()) {
    const nextIndex = starts[order + 1] ?? beats.length
    const start = beats[startIndex]?.time ?? 0
    const end = order + 1 < starts.length ? (beats[nextIndex]?.time ?? duration) : duration
    if (end <= start) continue

    bars.push({
      number: order + 1,
      start,
      end,
      beats: beats.slice(startIndex, nextIndex).map((beat) => beat.time),
    })
  }

  return bars
}

/**
 * Repartit les accords dans les mesures.
 *
 * Un accord qui deborde sur plusieurs mesures apparait dans chacune, tronque a ses
 * bornes : c'est ainsi qu'une grille se lit, mesure par mesure.
 */
export function assignChordsToBars(
  bars: readonly Bar[],
  chords: readonly Chord[],
): BarWithChords[] {
  return bars.map((bar) => {
    const span = bar.end - bar.start
    const within: BarChord[] = []

    for (const chord of chords) {
      if (chord.end <= bar.start) continue
      if (chord.start >= bar.end) break

      const start = Math.max(chord.start, bar.start)
      const end = Math.min(chord.end, bar.end)
      within.push({
        chord,
        offset: span > 0 ? (start - bar.start) / span : 0,
        width: span > 0 ? (end - start) / span : 1,
      })
    }

    return { ...bar, chords: within }
  })
}

export function barIndexAt(bars: readonly Bar[], time: number): number {
  return indexAt(bars, time)
}
