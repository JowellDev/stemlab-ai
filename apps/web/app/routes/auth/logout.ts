import { redirect } from 'react-router'
import { auth } from '~/lib/auth.server'
import type { Route } from './+types/logout'

/**
 * Deconnexion.
 *
 * En `action` uniquement : une deconnexion par simple visite d'URL serait
 * declenchable depuis n'importe quelle image distante.
 */
export async function action({ request }: Route.ActionArgs) {
  const response = await auth.api.signOut({ headers: request.headers, asResponse: true })
  const headers = new Headers(response.headers)
  headers.set('Location', '/')
  return new Response(null, { status: 303, headers })
}

export function loader() {
  return redirect('/')
}
