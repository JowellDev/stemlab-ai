import { Button } from '@stemlab/ui'
import { Download, X } from 'lucide-react'
import { useInstallPrompt } from '~/hooks/use-pwa'

/**
 * Invite d'installation.
 *
 * Elle n'apparait que lorsque le navigateur l'a proposee — donc quand
 * l'installation est reellement possible — et disparait definitivement si
 * l'utilisateur la refuse.
 */
export function InstallBanner() {
  const prompt = useInstallPrompt()
  if (!prompt.available) return null

  return (
    <aside className="bg-card flex items-center gap-3 rounded-lg border p-3">
      <Download aria-hidden className="text-brand size-4 shrink-0" />

      <p className="min-w-0 flex-1 text-sm">
        Installez STEMLAB pour y acceder hors connexion, depuis votre ecran d&apos;accueil.
      </p>

      <Button type="button" size="sm" onClick={() => void prompt.install()}>
        Installer
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Ne plus proposer l'installation"
        onClick={prompt.dismiss}
      >
        <X aria-hidden />
      </Button>
    </aside>
  )
}
