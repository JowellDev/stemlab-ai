import { CloudOff } from 'lucide-react'
import { useOnlineStatus } from '~/hooks/use-pwa'

/**
 * Indicateur de connexion.
 *
 * Affiche uniquement en l'absence de reseau : un bandeau permanent disant « en
 * ligne » n'apprendrait rien.
 */
export function OfflineIndicator() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      data-testid="offline-indicator"
      className="bg-muted text-muted-foreground flex items-center justify-center gap-2 px-4 py-1.5 text-xs"
    >
      <CloudOff aria-hidden className="size-3.5" />
      Hors connexion — seuls les morceaux telecharges sont ecoutables.
    </div>
  )
}
