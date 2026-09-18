import { type MultitrackPlayer, observePosition } from '@stemlab/audio-engine'
import { useEffect } from 'react'

/**
 * Suit la position de lecture et ne signale que les **changements** d'index.
 *
 * La recherche est faite a chaque frame — c'est une dichotomie, negligeable — mais
 * le rappel n'est declenche que lorsque l'element actif change. Un accord dure
 * plusieurs secondes : a 60 Hz, cela represente une notification pour trois cents
 * frames muettes.
 *
 * Le rappel recoit aussi la position brute, pour les affichages continus comme le
 * curseur de defilement.
 */
export function usePositionFollower(
  player: MultitrackPlayer | null,
  findIndex: (position: number) => number,
  onChange: (index: number, position: number) => void,
  onFrame?: (position: number) => void,
): void {
  useEffect(() => {
    if (!player) return

    let previous = Number.NaN

    return observePosition(player, (position) => {
      onFrame?.(position)
      const index = findIndex(position)
      if (index === previous) return
      previous = index
      onChange(index, position)
    })
  }, [player, findIndex, onChange, onFrame])
}
