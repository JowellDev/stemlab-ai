import type { QuotaUsage } from '@stemlab/contracts'
import { Progress } from '@stemlab/ui'

/**
 * Consommation du quota mensuel.
 *
 * Affichee en permanence plutot qu'au moment du refus : une limite qu'on
 * decouvre en s'y heurtant donne l'impression d'une panne. Un plan sans limite
 * n'affiche rien — il n'y a rien a surveiller.
 */
export function QuotaMeter({ quota }: { quota: QuotaUsage }) {
  if (quota.limit === null) return null

  const remaining = Math.max(0, quota.limit - quota.used)
  const exhausted = remaining === 0
  const resets = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(quota.resetsAt))

  return (
    <section
      aria-label="Quota mensuel"
      data-testid="quota-meter"
      className="flex flex-col gap-2 rounded-xl border border-input bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium">
          {exhausted
            ? 'Quota mensuel atteint'
            : `${remaining} morceau${remaining > 1 ? 'x' : ''} restant${remaining > 1 ? 's' : ''} ce mois-ci`}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {quota.used} / {quota.limit} · repart le {resets}
        </p>
      </div>

      <Progress
        value={Math.min(100, (quota.used / quota.limit) * 100)}
        aria-label={`${quota.used} morceaux sur ${quota.limit} utilises ce mois-ci`}
        className="h-1.5"
      />
    </section>
  )
}
