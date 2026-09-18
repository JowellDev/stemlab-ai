import { Button, cn } from '@stemlab/ui'
import { Check, CloudDownload, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { OfflineTrack } from '~/hooks/use-offline-track'

interface OfflineToggleProps {
  offline: OfflineTrack
  title: string
  className?: string
}

/**
 * Disponibilite hors-ligne d'un morceau.
 *
 * Le bouton dit toujours ce qu'il fera, pas seulement l'etat courant : « Rendre
 * disponible hors connexion » puis « Disponible hors connexion », qu'un second
 * clic retire apres confirmation.
 */
export function OfflineToggle({ offline, title, className }: OfflineToggleProps) {
  const [confirming, setConfirming] = useState(false)

  if (offline.state === 'unsupported' || offline.state === 'unknown') return null

  if (offline.state === 'downloading') {
    const { loaded = 0, total = 0 } = offline.progress ?? {}
    return (
      <span
        className={cn('text-muted-foreground flex items-center gap-1.5 text-xs', className)}
        aria-live="polite"
      >
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
        Telechargement {total > 0 ? `${loaded}/${total}` : ''}
      </span>
    )
  }

  if (offline.state === 'stored') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={
          confirming
            ? `Confirmer le retrait de ${title} du stockage hors connexion`
            : `${title} est disponible hors connexion — retirer du stockage`
        }
        onClick={() => {
          if (!confirming) {
            setConfirming(true)
            return
          }
          setConfirming(false)
          void offline.remove()
        }}
        onBlur={() => setConfirming(false)}
        className={cn(
          confirming ? 'text-destructive' : 'text-emerald-400 hover:text-destructive',
          className,
        )}
      >
        {confirming ? <Trash2 aria-hidden /> : <Check aria-hidden />}
        <span className="text-xs">{confirming ? 'Retirer ?' : 'Hors connexion'}</span>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Rendre ${title} disponible hors connexion`}
      onClick={() => void offline.download()}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <CloudDownload aria-hidden />
      <span className="text-xs">Hors connexion</span>
    </Button>
  )
}
