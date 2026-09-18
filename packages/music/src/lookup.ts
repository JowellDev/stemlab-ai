import type { Beat, Chord } from '@stemlab/contracts'

/**
 * Recherche de l'element actif a un instant donne.
 *
 * Ces fonctions sont appelees a chaque frame d'affichage : elles procedent par
 * dichotomie plutot que par balayage. Sur un morceau de six minutes, une grille
 * peut compter plusieurs centaines d'accords et un millier de temps.
 *
 * L'instant attendu est exprime dans le **temps du morceau**, pas en temps reel
 * ecoule. C'est ce que rend deja la position du lecteur : elle integre le facteur
 * de vitesse, si bien qu'un changement de tempo ne demande aucun realignement.
 */

/** Index de l'element dont l'intervalle contient `time`, ou -1. */
export function indexAt(
  items: ReadonlyArray<{ start: number; end: number }>,
  time: number,
): number {
  let low = 0
  let high = items.length - 1

  while (low <= high) {
    const middle = (low + high) >> 1
    const item = items[middle]
    if (!item) break
    if (time < item.start) {
      high = middle - 1
    } else if (time >= item.end) {
      low = middle + 1
    } else {
      return middle
    }
  }

  return -1
}

export function chordIndexAt(chords: readonly Chord[], time: number): number {
  return indexAt(chords, time)
}

export function chordAt(chords: readonly Chord[], time: number): Chord | null {
  const index = chordIndexAt(chords, time)
  return index === -1 ? null : (chords[index] ?? null)
}

/**
 * Index du dernier temps atteint, ou -1 avant le premier.
 *
 * Contrairement aux accords, les temps sont des instants et non des intervalles :
 * on cherche donc le dernier dont l'instant est passe.
 */
export function beatIndexAt(beats: readonly Beat[], time: number): number {
  let low = 0
  let high = beats.length - 1
  let found = -1

  while (low <= high) {
    const middle = (low + high) >> 1
    const beat = beats[middle]
    if (!beat) break
    if (beat.time <= time) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return found
}

export function beatAt(beats: readonly Beat[], time: number): Beat | null {
  const index = beatIndexAt(beats, time)
  return index === -1 ? null : (beats[index] ?? null)
}
