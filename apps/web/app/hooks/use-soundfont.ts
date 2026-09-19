import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSynthesizer,
  isBankCached,
  loadBank,
  type BankProgress,
} from '~/lib/soundfont.client'
import type { SoundFontSynthesizer } from '@stemlab/audio-engine'

export type BankState = 'absent' | 'cached' | 'loading' | 'ready' | 'failed'

export interface UseSoundFont {
  state: BankState
  progress: BankProgress | null
  error: string | null
  /** Charge la banque et rend le synthetiseur, pret a etre branche. */
  load: (context: AudioContext, file?: File) => Promise<SoundFontSynthesizer | null>
}

/**
 * Banque d'echantillons : etat de son chargement.
 *
 * Le telechargement est long la premiere fois — une vingtaine de megaoctets —
 * et instantane ensuite, puisque la banque reste sur l'appareil. L'interface
 * doit pouvoir dire lequel des deux se produit, sinon l'attente passe pour un
 * blocage.
 */
export function useSoundFont(): UseSoundFont {
  const [state, setState] = useState<BankState>('absent')
  const [progress, setProgress] = useState<BankProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const synthRef = useRef<SoundFontSynthesizer | null>(null)

  useEffect(() => {
    let annule = false
    void isBankCached().then((present) => {
      if (!annule && present) setState('cached')
    })
    return () => {
      annule = true
    }
  }, [])

  const load = useCallback(
    async (context: AudioContext, file?: File): Promise<SoundFontSynthesizer | null> => {
      // Un fichier choisi par l'utilisateur remplace la banque en cours : il n'y
      // a pas de raison de garder un synthetiseur accorde sur l'ancienne.
      if (synthRef.current && !file) return synthRef.current

      setState('loading')
      setError(null)

      try {
        const bank = file
          ? await file.arrayBuffer()
          : await loadBank({ onProgress: setProgress })

        const synth = await createSynthesizer(context, bank)
        synthRef.current = synth
        setState('ready')
        return synth
      } catch (cause) {
        setState('failed')
        setError(
          cause instanceof Error
            ? cause.message
            : "La banque d'echantillons n'a pas pu etre chargee.",
        )
        return null
      } finally {
        setProgress(null)
      }
    },
    [],
  )

  return { state, progress, error, load }
}
