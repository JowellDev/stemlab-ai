import {
  type Plan,
  type QuotaUsage,
  StemlabError,
  type SeparationModel,
  allowsModel,
  limitsFor,
  monthReset,
  monthStart,
} from '@stemlab/contracts'
import { db } from '~/lib/db.server'
import { env } from '~/lib/env.server'

/**
 * Quotas par utilisateur.
 *
 * Le comptage porte sur les morceaux **creees** dans le mois, pas sur ceux
 * presents : supprimer un morceau ne rend pas son credit. Autrement, la limite
 * ne limiterait que le stockage, pas le calcul — qui est ce qui coute.
 */

/**
 * Limite effective du plan.
 *
 * Les contrats portent la valeur par defaut, que les deux cotes lisent ; le
 * deploiement peut la relever sans nouveau build, et l'interface affiche alors
 * le chiffre que le serveur applique, puisqu'il le lui transmet.
 */
function monthlyLimit(plan: Plan): number | null {
  const base = limitsFor(plan).tracksPerMonth
  if (base === null) return null
  return plan === 'free' ? env.FREE_PLAN_MONTHLY_TRACKS : base
}

export async function usageFor(userId: string, plan: Plan, now = new Date()): Promise<QuotaUsage> {
  const limit = monthlyLimit(plan)

  const used =
    limit === null
      ? 0
      : await db.track.count({
          where: { userId, createdAt: { gte: monthStart(now) } },
        })

  return { plan, used, limit, resetsAt: monthReset(now).toISOString() }
}

/**
 * Verifie qu'un nouveau morceau tient dans le quota.
 *
 * `existingTrackId` couvre le cas du renvoi d'un fichier deja connu : il ne
 * consomme pas un nouveau credit, puisqu'il ne declenche pas un nouveau calcul.
 */
export async function assertCanAddTrack(
  userId: string,
  plan: Plan,
  options: { existingTrackId?: string | null; now?: Date } = {},
): Promise<void> {
  if (options.existingTrackId) return

  const limit = monthlyLimit(plan)
  if (limit === null) return

  const usage = await usageFor(userId, plan, options.now)
  if (usage.used < limit) return

  throw new StemlabError(
    'quota_exceeded',
    `Votre plan permet ${limit} morceaux par mois. ` +
      `Le compteur repart le ${formatReset(usage.resetsAt)}.`,
  )
}

export function assertCanUseModel(plan: Plan, model: SeparationModel): void {
  if (allowsModel(plan, model)) return

  throw new StemlabError(
    'forbidden',
    `La separation en ${limitsFor('pro').maxStems} pistes n'est pas incluse dans votre plan.`,
  )
}

function formatReset(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))
}
