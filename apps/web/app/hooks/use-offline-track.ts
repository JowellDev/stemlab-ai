import type { StemType } from '@stemlab/contracts'
import { OfflineDownloadError, QuotaExceededError, downloadTrack } from '@stemlab/offline'
import { useCallback, useEffect, useState } from 'react'
import { getOfflineStore } from '~/lib/offline.client'

export type OfflineState = 'unsupported' | 'unknown' | 'absent' | 'downloading' | 'stored'

export interface OfflineStemSource {
  type: StemType
  url: string
  format: string
}

export interface OfflineTrack {
  state: OfflineState
  /** Nombre de pistes deja recuperees, pendant le telechargement. */
  progress: { loaded: number; total: number } | null
  error: string | null
  download: () => Promise<void>
  remove: () => Promise<void>
}

export interface UseOfflineTrackOptions {
  trackId: string
  title: string
  /**
   * Fournit les URL des stems au moment du telechargement.
   *
   * Paresseux a dessein : depuis la bibliotheque, les URL presignees ne sont pas
   * chargees, et signer les stems de tous les morceaux a chaque affichage serait
   * du travail perdu pour la quasi-totalite d'entre eux.
   */
  loadStems: () => Promise<OfflineStemSource[]>
}

/**
 * Disponibilite hors-ligne d'un morceau.
 *
 * Le telechargement conserve aussi la page du morceau dans le cache du service
 * worker : sans elle, le morceau serait stocke mais sa page inaccessible en mode
 * avion — l'audio sans la porte d'entree.
 */
export function useOfflineTrack({
  trackId,
  title,
  loadStems,
}: UseOfflineTrackOptions): OfflineTrack {
  const [state, setState] = useState<OfflineState>('unknown')
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void getOfflineStore().then(async (store) => {
      if (cancelled) return
      if (!store) {
        setState('unsupported')
        return
      }
      const stored = await store.has(trackId)
      if (!cancelled) setState(stored ? 'stored' : 'absent')
    })

    return () => {
      cancelled = true
    }
  }, [trackId])

  const download = useCallback(async () => {
    const store = await getOfflineStore()
    if (!store) return

    setError(null)
    setState('downloading')

    try {
      const stems = await loadStems()
      setProgress({ loaded: 0, total: stems.length })

      await downloadTrack(store, { trackId, title }, stems, {
        onProgress: (update) => setProgress({ loaded: update.loaded, total: update.total }),
      })
      await warmPageCache(trackId)
      setState('stored')
    } catch (cause) {
      setState('absent')
      setError(describeFailure(cause))
      // Le message affiche reste court ; la cause exacte va dans la console, ou
      // elle sert au diagnostic sans encombrer l'interface.
      console.error('telechargement hors-ligne', cause)
    } finally {
      setProgress(null)
    }
  }, [trackId, title, loadStems])

  const remove = useCallback(async () => {
    const store = await getOfflineStore()
    if (!store) return
    await store.remove(trackId)
    setState('absent')
  }, [trackId])

  return { state, progress, error, download, remove }
}

/** Message utilisateur, aussi precis que la cause le permet. */
function describeFailure(cause: unknown): string {
  if (cause instanceof QuotaExceededError) {
    return "Espace insuffisant. Retirez d'autres morceaux du stockage hors connexion."
  }
  if (cause instanceof OfflineDownloadError) {
    return `Telechargement interrompu sur la piste « ${cause.stemType} ».`
  }
  if (cause instanceof Error) {
    return `Le telechargement a echoue : ${cause.message}`
  }
  return 'Le telechargement a echoue.'
}

/**
 * Met la page du morceau dans le cache du service worker.
 *
 * Le stockage des stems ne suffit pas : sans la page, une navigation hors reseau
 * retomberait sur l'ecran « hors connexion ».
 */
async function warmPageCache(trackId: string): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open('pages')
    await cache.add(`/tracks/${trackId}`)
  } catch {
    // Le cache nomme peut ne pas exister si le service worker n'est pas actif :
    // le morceau reste stocke, seule la navigation hors-ligne en patira.
  }
}
