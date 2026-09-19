import {
  ChordPad,
  LibraryPad,
  SoundFontPad,
  createAudioContext,
  unlockOnFirstGesture,
} from '@stemlab/audio-engine'
import { type ChordQuality, chordNotes, keyId } from '@stemlab/music'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePadLibrary, type UsePadLibrary } from '~/hooks/use-pad-library'
import { useSoundFont, type UseSoundFont } from '~/hooks/use-soundfont'

export type PadSource = 'synth' | 'soundfont' | 'library'

export interface ChordPadSettings {
  readonly source: PadSource
  readonly voice: string
  readonly volume: number
  readonly smoothness: number
  readonly octave: number
  /** Programme General MIDI, quand la source est echantillonnee. */
  readonly program: number
  /** Tonalite courante : elle designe la nappe a jouer, pour la bibliotheque. */
  readonly keyRoot: number
  readonly keyMode: 'major' | 'minor'
  /** Duree du fondu entre deux tonalites, en secondes. */
  readonly crossfade: number
}

export interface PlayableChord {
  readonly label: string
  readonly root: number
  readonly quality: ChordQuality
}

export interface UseChordPad {
  /** Libelle de l'accord tenu, ou `null` quand le pad se tait. */
  active: string | null
  play: (chord: PlayableChord) => void
  stop: () => void
  /** Charge la banque d'echantillons, ou en remplace la source par un fichier. */
  loadBank: (file?: File) => Promise<void>
  bank: UseSoundFont
  library: UsePadLibrary
  /** Vrai quand la tonalite courante n'a aucune nappe importee. */
  missingKey: boolean
}

/**
 * Cycle de vie du pad, quelle que soit sa source.
 *
 * Le contexte audio n'est cree qu'au premier accord : le creer au montage
 * laisserait un contexte suspendu sur toute page visitee sans jouer une note,
 * ce que Safari compte au nombre de ses contextes autorises.
 *
 * Les deux sources coexistent plutot que de se remplacer. Passer de l'une a
 * l'autre pendant qu'un accord sonne doit rester possible, et reconstruire la
 * source a chaque bascule couperait le son.
 */
export function useChordPad(settings: ChordPadSettings): UseChordPad {
  const bank = useSoundFont()
  const [libraryPadRef, setLibraryPad] = useState<LibraryPad | null>(null)
  const library = usePadLibrary(libraryPadRef)
  // Miroir du pad de bibliotheque, pour le liberer au demontage : l'effet de
  // nettoyage ne doit pas se rejouer chaque fois que le pad change.
  const libraryForCleanup = useRef<LibraryPad | null>(null)
  useEffect(() => {
    libraryForCleanup.current = libraryPadRef
  }, [libraryPadRef])
  const contextRef = useRef<AudioContext | null>(null)
  const unlockRef = useRef<(() => void) | null>(null)
  const synthPadRef = useRef<ChordPad | null>(null)
  const samplePadRef = useRef<SoundFontPad | null>(null)
  const [active, setActive] = useState<string | null>(null)

  // Les rappels lisent les reglages au moment ou ils s'executent, pas a celui
  // ou ils sont crees : sans cette copie, jouer un accord utiliserait les
  // reglages figes au dernier rendu qui a recree le rappel.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  })

  const ensureContext = useCallback((): AudioContext => {
    if (contextRef.current) return contextRef.current
    const context = createAudioContext()
    unlockRef.current = unlockOnFirstGesture(context)
    contextRef.current = context
    return context
  }, [])

  const ensureSynth = useCallback((): ChordPad => {
    if (synthPadRef.current) return synthPadRef.current
    const current = settingsRef.current
    const pad = new ChordPad(ensureContext(), {
      voice: current.voice,
      volume: current.volume,
      smoothness: current.smoothness,
    })
    synthPadRef.current = pad
    return pad
  }, [ensureContext])

  // La bibliotheque a besoin d'un contexte pour decoder : on le cree des que la
  // source est choisie, et pas avant.
  useEffect(() => {
    if (settings.source !== 'library' || libraryPadRef) return
    setLibraryPad(new LibraryPad(ensureContext(), { crossfade: settings.crossfade }))
  }, [settings.source, settings.crossfade, libraryPadRef, ensureContext])

  useEffect(() => {
    libraryPadRef?.setCrossfade(settings.crossfade)
  }, [libraryPadRef, settings.crossfade])

  useEffect(() => {
    return () => {
      synthPadRef.current?.dispose()
      samplePadRef.current?.dispose()
      synthPadRef.current = null
      samplePadRef.current = null
      libraryForCleanup.current?.dispose()
      unlockRef.current?.()
      void contextRef.current?.close().catch(() => {
        // Contexte deja ferme : il n'y a plus rien a liberer.
      })
      contextRef.current = null
    }
  }, [])

  // Les reglages sont propages aux deux sources : celle qui dort doit etre a
  // jour quand on y revient.
  useEffect(() => {
    synthPadRef.current?.setVoice(settings.voice)
    samplePadRef.current?.setVoice(settings.voice)
  }, [settings.voice])

  useEffect(() => {
    synthPadRef.current?.setVolume(settings.volume)
    samplePadRef.current?.setVolume(settings.volume)
    libraryPadRef?.setVolume(settings.volume)
  }, [settings.volume, libraryPadRef])

  useEffect(() => {
    synthPadRef.current?.setSmoothness(settings.smoothness)
  }, [settings.smoothness])

  useEffect(() => {
    samplePadRef.current?.setProgram(settings.program)
  }, [settings.program])

  const loadBank = useCallback(
    async (file?: File): Promise<void> => {
      const context = ensureContext()
      await context.resume().catch(() => {
        // Le geste n'etait pas eligible : le deverrouillage global prend le relais.
      })

      const synth = await bank.load(context, file)
      if (!synth) return

      samplePadRef.current?.dispose()
      const current = settingsRef.current
      samplePadRef.current = new SoundFontPad(context, synth, {
        voice: current.voice,
        volume: current.volume,
        program: current.program,
      })
    },
    [bank, ensureContext],
  )

  const currentKey = keyId(settings.keyRoot, settings.keyMode)
  const missingKey = settings.source === 'library' && !library.ready.has(currentKey)

  // La bibliotheque tient une nappe par tonalite : quand la tonalite change, la
  // nappe suit, sans qu'on ait a toucher un accord.
  useEffect(() => {
    if (settingsRef.current.source !== 'library') return
    // Rien a faire tant que rien ne sonne : changer de tonalite n'allume pas le
    // pad, cela suit ce qui est deja en cours.
    if (!libraryPadRef || libraryPadRef.current === null) return
    libraryPadRef.play(currentKey)
  }, [currentKey, libraryPadRef])

  const play = useCallback(
    (chord: PlayableChord) => {
      const current = settingsRef.current

      // Une nappe enregistree couvre une tonalite entiere, pas un accord : quel
      // que soit le pad touche, c'est la nappe de la tonalite qui sonne. Le
      // dire dans l'interface evite que l'ecart passe pour un defaut.
      if (current.source === 'library') {
        const pad = libraryPadRef
        if (!pad) return

        if (pad.current !== null) {
          pad.stop()
          setActive(null)
          return
        }

        synthPadRef.current?.stop()
        samplePadRef.current?.stop()
        if (pad.play(keyId(current.keyRoot, current.keyMode))) setActive(chord.label)
        return
      }

      const pad = current.source === 'soundfont' ? samplePadRef.current : ensureSynth()
      if (!pad) return

      void contextRef.current?.resume().catch(() => {
        // Voir ci-dessus : le deverrouillage global prend le relais.
      })

      // Rejouer l'accord tenu le coupe : c'est le geste attendu d'un pad, ou
      // l'on retire la main pour laisser le silence.
      if (active === chord.label) {
        pad.stop()
        setActive(null)
        return
      }

      // L'autre source doit se taire, sinon les deux se superposeraient.
      const autre = current.source === 'soundfont' ? synthPadRef.current : samplePadRef.current
      autre?.stop()

      pad.play(
        chordNotes(chord.root, chord.quality, {
          octave: current.octave,
          bass: true,
          spread: true,
        }),
      )
      setActive(chord.label)
    },
    [active, ensureSynth, libraryPadRef],
  )

  const stop = useCallback(() => {
    synthPadRef.current?.stop()
    samplePadRef.current?.stop()
    libraryPadRef?.stop()
    setActive(null)
  }, [libraryPadRef])

  return { active, play, stop, loadBank, bank, library, missingKey }
}
