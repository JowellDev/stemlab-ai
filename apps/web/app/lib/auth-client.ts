import { createAuthClient } from 'better-auth/react'

/**
 * Client d'authentification, cote navigateur.
 *
 * Aucune URL de base n'est fixee : les appels partent en relatif vers la meme
 * origine, ce qui evite d'avoir a exposer une variable d'environnement au bundle.
 */
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
