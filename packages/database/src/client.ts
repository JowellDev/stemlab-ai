import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'

/**
 * Client Prisma partage.
 *
 * Le paquet ne lit pas l'environnement de lui-meme : la chaine de connexion lui est
 * passee par l'application, qui l'a deja validee. Cela evite qu'une configuration
 * invalide se manifeste au premier acces a la base plutot qu'au demarrage.
 */

export interface DatabaseOptions {
  connectionString: string
  /** Journalisation Prisma. Par defaut : erreurs seulement. */
  log?: Array<'query' | 'info' | 'warn' | 'error'>
}

export function createDatabase(options: DatabaseOptions): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.connectionString }),
    log: options.log ?? ['error'],
  })
}

const globalForPrisma = globalThis as unknown as { __stemlabPrisma?: PrismaClient }

/**
 * Instance unique pour tout le processus.
 *
 * En developpement, le rechargement a chaud reevalue les modules a chaque edition :
 * sans le cache sur `globalThis`, chaque modification ouvrirait un nouveau pool de
 * connexions jusqu'a epuiser Postgres.
 */
export function getDatabase(options: DatabaseOptions, cache = true): PrismaClient {
  if (!cache) return createDatabase(options)
  globalForPrisma.__stemlabPrisma ??= createDatabase(options)
  return globalForPrisma.__stemlabPrisma
}

export type { PrismaClient }
