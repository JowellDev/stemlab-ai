import { z } from 'zod'
import type { SeparationModel } from './primitives.js'

/**
 * Plans et quotas.
 *
 * Ils vivent dans les contrats plutot que dans le serveur : l'interface doit
 * annoncer la limite avant que l'utilisateur ne s'y heurte, et les deux cotes
 * doivent lire le meme chiffre. Une limite affichee qui differe de la limite
 * appliquee est pire que pas de limite affichee du tout.
 */

export const Plan = z.enum(['free', 'pro'])
export type Plan = z.infer<typeof Plan>

export interface PlanLimits {
  /** Morceaux ajoutes par mois calendaire. `null` = sans limite. */
  readonly tracksPerMonth: number | null
  /** Modeles de separation autorises. */
  readonly models: readonly SeparationModel[]
  /** Nombre de pistes que le meilleur modele autorise produit. */
  readonly maxStems: number
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { tracksPerMonth: 5, models: ['htdemucs'], maxStems: 4 },
  pro: { tracksPerMonth: null, models: ['htdemucs', 'htdemucs_6s'], maxStems: 6 },
}

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan]
}

export function allowsModel(plan: Plan, model: SeparationModel): boolean {
  return PLAN_LIMITS[plan].models.includes(model)
}

/**
 * Debut du mois calendaire courant, en UTC.
 *
 * Un mois calendaire plutot qu'une fenetre glissante : l'utilisateur sait quand
 * son quota repart, et la requete se resume a une comparaison de dates. En UTC
 * pour que le serveur et la base comptent la meme chose ou qu'ils tournent.
 */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Premier instant du mois suivant : la date a laquelle le quota repart. */
export function monthReset(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

export const QuotaUsage = z.object({
  plan: Plan,
  used: z.number().int().min(0),
  /** `null` quand le plan n'impose pas de limite. */
  limit: z.number().int().min(0).nullable(),
  resetsAt: z.iso.datetime(),
})
export type QuotaUsage = z.infer<typeof QuotaUsage>
