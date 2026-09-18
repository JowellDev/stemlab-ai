import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { db } from './db.server'
import { env, hasGoogleOAuth, isProduction } from './env.server'

/**
 * Authentification.
 *
 * Sessions en base plutot qu'en JWT : c'est ce qui permet de revoquer un acces
 * immediatement, et de lister les appareils connectes. Le cookie de session porte
 * un jeton opaque, rien d'exploitable cote client.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.APP_URL, env.BETTER_AUTH_URL],

  emailAndPassword: {
    enabled: true,
    // Pas de verification par courriel pour l'instant : il n'y a pas encore de
    // service d'envoi. A activer en phase 8 avec le fournisseur retenu.
    requireEmailVerification: false,
    minPasswordLength: 10,
  },

  socialProviders: hasGoogleOAuth
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {},

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    // Prolonge la session a chaque journee d'activite, sans ecrire a chaque requete.
    updateAge: 60 * 60 * 24,
  },

  advanced: {
    useSecureCookies: isProduction,
    cookiePrefix: 'stemlab',
  },

  user: {
    additionalFields: {
      plan: { type: 'string', required: false, input: false },
    },
  },
})

export type Auth = typeof auth
