import { getDatabase } from '@stemlab/database'
import { env, isProduction } from './env.server'

/**
 * Acces a la base pour le BFF.
 *
 * Le schema et le client vivent dans `packages/database` ; l'application ne fournit
 * que sa configuration, deja validee au demarrage.
 */
export const db = getDatabase({
  connectionString: env.DATABASE_URL,
  log: isProduction ? ['error'] : ['warn', 'error'],
})

export type { PrismaClient } from '@stemlab/database'
