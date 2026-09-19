import { Metronome, type MetronomeBeat, observePosition } from '@stemlab/audio-engine'
import type { MultitrackPlayer } from '@stemlab/audio-engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface UseMetronome {
  enabled: boolean
  volume: number
  /** Rang du temps accentue, a partir de 1. */
  accentBeat: number
  /** Temps par mesure, deduit de l'analyse. */
  beatsPerBar: number
  setEnabled: (value: boolean) => void
  setVolume: (value: number) => void
  /** Deplace l'accent d'un temps, en bouclant sur la mesure. */
  shiftAccent: () => void
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
  const [accentBeat, setAccentBeat] = useState(1)
  const metronomeRef = useRef<Metronome | null>(null)

  // La detection de la mesure est une estimation : le musicien doit pouvoir
  // recaler l'accent sans relancer quoi que ce soit.
  const beatsPerBar = useMemo(() => {
    let maximum = 1
    for (const beat of beats) maximum = Math.max(maximum, beat.position)
    return maximum
  }, [beats])

  useEffect(() => {
    if (!player || !enabled || beats.length === 0) return

    // Le moteur d'etirement rend sa sortie apres un delai fixe : sans cette
    // compensation, les clics tombent en avance et s'entendent comme un
    // contretemps.
    const metronome = new Metronome(player.context, {
      volume,
      latency: player.outputLatency,
      accentBeat,
    })
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
    // `volume` et `accentBeat` sont volontairement absents : recreer le
    // metronome a chaque reglage couperait le clic. Ils sont appliques par les
    // effets suivants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, enabled, beats])

  useEffect(() => {
    metronomeRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    metronomeRef.current?.setAccentBeat(accentBeat)
  }, [accentBeat])

  const shiftAccent = useCallback(() => {
    setAccentBeat((current) => (current % beatsPerBar) + 1)
  }, [beatsPerBar])

  return { enabled, volume, accentBeat, beatsPerBar, setEnabled, setVolume, shiftAccent }
}
