import { Metronome, type MetronomeBeat, observePosition } from '@stemlab/audio-engine'
import type { MultitrackPlayer } from '@stemlab/audio-engine'
import { useEffect, useRef, useState } from 'react'

export interface UseMetronome {
  enabled: boolean
  volume: number
  setEnabled: (value: boolean) => void
  setVolume: (value: number) => void
}

/**
 * Metronome accroche au lecteur.
 *
 * La programmation est relancee a chaque image plutot qu'a intervalle fixe :
 * c'est le meme signal qui fait avancer la grille d'accords, donc un
 * deplacement de la tete de lecture est pris en compte sans delai. Le cout est
 * negligeable — la boucle ne fait que comparer des nombres tant qu'aucun temps
 * n'entre dans la fenetre.
 */
export function useMetronome(
  player: MultitrackPlayer | null,
  beats: readonly MetronomeBeat[],
): UseMetronome {
  const [enabled, setEnabled] = useState(false)
  const [volume, setVolume] = useState(0.35)
  const metronomeRef = useRef<Metronome | null>(null)

  useEffect(() => {
    if (!player || !enabled || beats.length === 0) return

    const metronome = new Metronome(player.context, { volume })
    metronome.setBeats(beats)
    metronomeRef.current = metronome

    const stop = observePosition(player, (position) => {
      metronome.schedule(position, player.playbackRate)
    })

    return () => {
      stop()
      metronome.dispose()
      metronomeRef.current = null
    }
    // `volume` est volontairement absent : le recreer a chaque mouvement du
    // curseur couperait le clic. Il est applique par l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, enabled, beats])

  useEffect(() => {
    metronomeRef.current?.setVolume(volume)
  }, [volume])

  return { enabled, volume, setEnabled, setVolume }
}
