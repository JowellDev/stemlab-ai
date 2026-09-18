import { auth } from '~/lib/auth.server'
import { toErrorResponse } from '~/lib/errors.server'
import { enforce, identify } from '~/lib/rate-limit.server'
import type { Route } from './+types/auth.$'

/**
 * Point d'entree unique de better-auth : inscription, connexion, deconnexion,
 * rappel OAuth. La bibliotheque gere le routage interne a partir du chemin.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request)
}

/**
 * Les ecritures passent par une limite de debit : c'est ici qu'aboutit le
 * bourrage d'identifiants. La limite porte sur l'adresse, seule identite
 * disponible avant que la session n'existe.
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    await enforce('auth', identify(request))
    return await auth.handler(request)
  } catch (error) {
    return toErrorResponse(error)
  }
}
