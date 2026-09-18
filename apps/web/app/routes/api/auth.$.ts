import { auth } from '~/lib/auth.server'
import type { Route } from './+types/auth.$'

/**
 * Point d'entree unique de better-auth : inscription, connexion, deconnexion,
 * rappel OAuth. La bibliotheque gere le routage interne a partir du chemin.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request)
}

export async function action({ request }: Route.ActionArgs) {
  return auth.handler(request)
}
