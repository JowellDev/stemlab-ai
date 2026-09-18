import { ChordPad, createAudioContext, unlockOnFirstGesture } from '@stemlab/audio-engine'
import { chordNotes, type ChordQuality } from '@stemlab/music'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseChordPad {
  /** Libelle de l'accord tenu, ou `null` quand le pad se tait. */
  active: string | null
  ready: boolean
  play: (chord: { label: string; root: number; quality: ChordQuality }) => void
  stop: () => void
  setVoice: (id: string) => void
  setVolume: (value: number) => void
  setSmoothness: (value: number) => void
  setOctave: (value: number) => void
}

export interface ChordPadSettings {
  readonly voice: string
  readonly volume: number
  readonly smoothness: number
  readonly octave: number
}

/**
 * Cycle de vie du pad d'accords.
 *
 * Le contexte audio n'est cree qu'au premier accord joue : le creer au montage
 * laisserait un contexte suspendu sur toute page visitee sans jouer une note, ce
 * que Safari compte au nombre de ses contextes autorises.
 */
export function useChordPad(settings: ChordPadSettings): UseChordPad {
  const padRef = useRef<ChordPad | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const unlockRef = useRef<(() => void) | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const ensure = useCallback((): ChordPad => {
    if (padRef.current) return padRef.current

    const context = createAudioContext()
    unlockRef.current = unlockOnFirstGesture(context)
    contextRef.current = context

    const pad = new ChordPad(context, {
      voice: settings.voice,
      volume: settings.volume,
      smoothness: settings.smoothness,
    })
    padRef.current = pad
    setReady(true)
    return pad
    // Les reglages sont relus a chaque rendu par les effets ci-dessous : les
    // inclure ici recreerait le pad au moindre mouvement de curseur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      padRef.current?.dispose()
      padRef.current = null
      unlockRef.current?.()
      void contextRef.current?.close().catch(() => {
        // Contexte deja ferme : il n'y a plus rien a liberer.
      })
      contextRef.current = null
    }
  }, [])

  useEffect(() => {
    padRef.current?.setVoice(settings.voice)
  }, [settings.voice])

  useEffect(() => {
    padRef.current?.setVolume(settings.volume)
  }, [settings.volume])

  useEffect(() => {
    padRef.current?.setSmoothness(settings.smoothness)
  }, [settings.smoothness])

  const play = useCallback(
    (chord: { label: string; root: number; quality: ChordQuality }) => {
      const pad = ensure()
      void contextRef.current?.resume().catch(() => {
        // Le geste n'etait pas eligible : le deverrouillage global prendra le relais.
      })

      // Rejouer l'accord tenu le coupe : c'est le geste attendu d'un pad, ou
      // l'on retire la main pour laisser le silence.
      if (active === chord.label) {
        pad.stop()
        setActive(null)
        return
      }

      pad.play(
        chordNotes(chord.root, chord.quality, {
          octave: settings.octave,
          bass: true,
          spread: true,
        }),
      )
      setActive(chord.label)
    },
    [active, ensure, settings.octave],
  )

  const stop = useCallback(() => {
    padRef.current?.stop()
    setActive(null)
  }, [])

  const setVoice = useCallback((id: string) => padRef.current?.setVoice(id), [])
  const setVolume = useCallback((value: number) => padRef.current?.setVolume(value), [])
  const setSmoothness = useCallback((value: number) => padRef.current?.setSmoothness(value), [])
  const setOctave = useCallback(() => {}, [])

  return { active, ready, play, stop, setVoice, setVolume, setSmoothness, setOctave }
}
