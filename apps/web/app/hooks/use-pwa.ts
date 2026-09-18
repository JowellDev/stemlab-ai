import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Evenement propose par Chrome avant l'installation.
 *
 * Il n'est pas encore standard : la declaration vit donc ici plutot que dans les
 * types du DOM.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'stemlab:install-dismissed'

export interface InstallPrompt {
  /** Vrai quand le navigateur a propose l'installation et qu'elle n'a pas eu lieu. */
  available: boolean
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  dismiss: () => void
}

/**
 * Invite d'installation.
 *
 * Le navigateur decide *quand* proposer ; l'application decide *ou*. Intercepter
 * l'evenement permet de placer le bouton la ou il a du sens, plutot que de laisser
 * surgir une barre en bas de page.
 *
 * Un refus est memorise : reproposer a chaque visite serait harcelant.
 */
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const dismissed = useSyncExternalStore(subscribeToDismissal, readDismissed, () => true)

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return 'unavailable' as const
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    if (outcome === 'dismissed') rememberDismissed()
    return outcome
  }, [deferred])

  const dismiss = useCallback(() => {
    rememberDismissed()
    setDeferred(null)
  }, [])

  return { available: deferred !== null && !dismissed, install, dismiss }
}

/**
 * Vrai quand l'application tourne en fenetre autonome plutot que dans un onglet.
 *
 * Rendu comme « non » cote serveur : la valeur n'est connue que du navigateur.
 */
export function useIsStandalone(): boolean {
  return useSyncExternalStore(subscribeToDisplayMode, readStandalone, () => false)
}

/** Etat de la connexion, pour adapter ce que l'interface propose. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeToConnectivity, readOnline, () => true)
}

// --- stores externes -------------------------------------------------------
//
// Ces trois valeurs vivent hors de React : le navigateur les modifie de son cote.
// `useSyncExternalStore` est fait pour ca, et rend le cas serveur explicite.

function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function readOnline(): boolean {
  return navigator.onLine
}

function subscribeToDisplayMode(onChange: () => void): () => void {
  const query = window.matchMedia('(display-mode: standalone)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

/** Le refus est propre a l'onglet courant ; un autre onglet le signale par `storage`. */
function subscribeToDismissal(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Stockage refuse (navigation privee, cookies bloques) : on propose quand meme.
    return false
  }
}

function rememberDismissed(): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, '1')
    // `storage` ne se declenche pas dans l'onglet qui ecrit : on le simule.
    window.dispatchEvent(new StorageEvent('storage', { key: DISMISSED_KEY }))
  } catch {
    // Sans stockage, le refus ne survit pas au rechargement. C'est acceptable.
  }
}
