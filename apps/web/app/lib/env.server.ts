import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Environnement du serveur : charge une fois, valide une fois.
 *
 * Un `.env` unique vit a la racine du monorepo. Le charger ici plutot que de le
 * dupliquer par application evite qu'une copie derive de l'autre. Node sait le faire
 * sans dependance depuis la 20.12.
 *
 * La validation est stricte et se produit au demarrage : une configuration
 * incomplete doit faire echouer le processus tout de suite, pas a la premiere
 * requete d'un utilisateur.
 */

function loadRootEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [
    resolve(here, '../../../../.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '.env'),
  ]) {
    if (!existsSync(candidate)) continue
    try {
      process.loadEnvFile(candidate)
    } catch {
      // Les variables deja presentes dans l'environnement l'emportent : en
      // production il n'y a pas de fichier, et c'est normal.
    }
    return
  }
}

loadRootEnvFile()

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),

  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanish.default(true),
  S3_PUBLIC_URL: z.string().default(''),

  BETTER_AUTH_SECRET: z.string().min(16, 'BETTER_AUTH_SECRET doit faire au moins 16 caracteres'),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),

  ML_API_URL: z.url().default('http://localhost:8000'),
  ML_WEBHOOK_SECRET: z.string().min(8),
  /** Laisser vide pour la deriver d'`APP_URL`. A renseigner seulement quand le
   *  worker voit l'application sous une autre adresse (Docker, reseau prive). */
  ML_WEBHOOK_URL: z.string().default(''),
  ML_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

  FREE_PLAN_MONTHLY_TRACKS: z.coerce.number().int().positive().default(5),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),

  SENTRY_DSN: z.string().default(''),
})

export type Env = z.infer<typeof EnvSchema>

function parseEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env)
  if (parsed.success) return parsed.data

  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
    .join('\n')
  throw new Error(`Configuration invalide — variables d'environnement :\n${details}`)
}

const parsed = parseEnv()

export const env: Env = {
  ...parsed,
  // Deriver plutot que dupliquer : une URL de rappel qui pointe vers un autre port
  // que celui ou tourne l'application est une panne silencieuse.
  ML_WEBHOOK_URL:
    parsed.ML_WEBHOOK_URL || new URL('/api/internal/jobs/callback', parsed.APP_URL).toString(),
}

export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'

/** L'authentification Google n'est proposee que si elle est configuree. */
export const hasGoogleOAuth = env.GOOGLE_CLIENT_ID !== '' && env.GOOGLE_CLIENT_SECRET !== ''
