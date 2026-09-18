import { redirect } from 'react-router'
import { auth } from './auth.server'
import { db } from './db.server'
import { tagUser } from '~/lib/logger.server'

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
  plan: 'free' | 'pro'
}

/** Utilisateur connecte, ou `null`. Ne redirige pas. */
export async function getUser(request: Request): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return null

  // `plan` est un champ metier : better-auth le porte, mais on relit la source de
  // verite pour qu'un changement d'abonnement prenne effet sans reconnexion.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, image: true, plan: true },
  })
  if (!user) return null

  // Toutes les lignes de journal de cette requete porteront desormais l'auteur.
  tagUser(user.id)

  return { ...user, plan: user.plan }
}

/**
 * Utilisateur connecte, ou redirection vers la connexion.
 *
 * L'adresse demandee est conservee pour y revenir apres authentification : rien
 * n'est plus agacant que d'etre renvoye a l'accueil apres s'etre connecte.
 */
export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getUser(request)
  if (user) return user

  const url = new URL(request.url)
  const target = `${url.pathname}${url.search}`
  const search = target === '/' ? '' : `?redirectTo=${encodeURIComponent(target)}`
  throw redirect(`/login${search}`)
}

/** Variante pour les routes d'API : une 401 plutot qu'une redirection. */
export async function requireUserForApi(request: Request): Promise<SessionUser> {
  const user = await getUser(request)
  if (user) return user
  throw new Response(JSON.stringify({ code: 'unauthorized', message: 'connexion requise' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}
