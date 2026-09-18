import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * Configuration Prisma 7.
 *
 * L'URL de connexion ne vit plus dans le schema : les commandes de migration la
 * lisent ici, et le client d'execution la recoit par son adaptateur
 * (`app/lib/db.server.ts`). Prisma 7 ne charge plus `.env` de lui-meme, d'ou le
 * chargement explicite du fichier unique de la racine.
 */
const rootEnv = resolve(import.meta.dirname, '../../.env')
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv)
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
})
