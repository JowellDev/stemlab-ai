#!/usr/bin/env node
/**
 * Verifie qu'un environnement est deployable avant de deployer.
 *
 * Les erreurs de configuration ne se voient qu'a l'execution, souvent apres la
 * bascule du trafic : une cle manquante rend une page blanche, un secret laisse
 * a sa valeur d'exemple ouvre la porte a tout le monde. Ce controle rend ces
 * fautes visibles pendant qu'il est encore temps.
 *
 * Usage :
 *   node scripts/preflight.mjs                 # lit le .env local
 *   node scripts/preflight.mjs --env-only      # lit l'environnement du processus
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

if (!process.argv.includes('--env-only')) {
  const local = join(ROOT, '.env')
  if (existsSync(local)) process.loadEnvFile(local)
}

const production = process.env.NODE_ENV === 'production'

/** Valeurs d'exemple qui ne doivent jamais atteindre la production. */
const PLACEHOLDERS = [
  'dev-only-change-me',
  'changeme',
  'stemlab:stemlab',
  'minioadmin',
  'localhost',
  '127.0.0.1',
  'example.com',
]

const checks = []
const fail = (message) => checks.push({ ok: false, message })
const pass = (message) => checks.push({ ok: true, message })

function required(name, { secret = false, minLength = 1 } = {}) {
  const value = process.env[name]
  if (!value || value.length < minLength) {
    fail(`${name} est absent ou trop court (minimum ${minLength})`)
    return null
  }
  pass(`${name} ${secret ? 'present' : `= ${value}`}`)
  return value
}

function refusePlaceholder(name) {
  const value = process.env[name]
  if (!value) return
  const found = PLACEHOLDERS.find((needle) => value.toLowerCase().includes(needle))
  if (found) fail(`${name} contient une valeur d'exemple (« ${found} »)`)
}

// --- indispensables --------------------------------------------------------
required('DATABASE_URL')
required('S3_BUCKET')
required('S3_ACCESS_KEY_ID', { secret: true })
required('S3_SECRET_ACCESS_KEY', { secret: true })
required('BETTER_AUTH_SECRET', { secret: true, minLength: 32 })
required('ML_WEBHOOK_SECRET', { secret: true, minLength: 16 })
const appUrl = required('APP_URL')

// --- specifiques a la production -------------------------------------------
if (production) {
  for (const name of [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'ML_WEBHOOK_SECRET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'APP_URL',
    'BETTER_AUTH_URL',
    'ML_API_URL',
  ]) {
    refusePlaceholder(name)
  }

  // Sans HTTPS, le cookie de session voyage en clair et le service worker ne
  // s'enregistre meme pas.
  if (appUrl && !appUrl.startsWith('https://')) {
    fail(`APP_URL doit etre en https en production (${appUrl})`)
  }

  // Sans Redis, la limitation de debit retombe sur un compteur local : la limite
  // se retrouve divisee par le nombre d'instances, sans que rien ne le signale.
  if (!process.env.REDIS_URL) {
    fail('REDIS_URL est absent : la limitation de debit ne serait plus partagee')
  } else {
    pass('REDIS_URL present : limitation de debit partagee entre instances')
  }

  if (!process.env.METRICS_TOKEN) {
    fail('METRICS_TOKEN est absent : /metrics serait inaccessible en production')
  }

  // --- particularites de Cloudflare R2 ------------------------------------
  const endpoint = process.env.S3_ENDPOINT ?? ''
  if (endpoint.includes('r2.cloudflarestorage.com')) {
    // R2 n'a qu'une region logique. Toute autre valeur fait echouer la
    // signature, et le message d'erreur ne dit pas pourquoi.
    if ((process.env.S3_REGION ?? '') !== 'auto') {
      fail(`S3_REGION doit valoir « auto » sur R2 (actuellement « ${process.env.S3_REGION} »)`)
    } else {
      pass('S3_REGION = auto, comme R2 l exige')
    }

    if ((process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false') {
      fail('S3_FORCE_PATH_STYLE doit valoir false sur R2')
    }
  }

  // Le seau ne doit jamais etre public : les adresses de lecture sont signees et
  // expirantes, et c'est ce que la page legale promet.
  if (process.env.S3_PUBLIC_URL) {
    fail(
      'S3_PUBLIC_URL n est plus utilise : une adresse publique et permanente ' +
        'contredit la promesse de confidentialite. Retirez la variable.',
    )
  }

  if (!process.env.SENTRY_DSN) {
    checks.push({ ok: true, warn: true, message: 'SENTRY_DSN absent : aucune remontee d erreur' })
  }
}

// --- coherence -------------------------------------------------------------
const authUrl = process.env.BETTER_AUTH_URL
if (appUrl && authUrl && appUrl !== authUrl) {
  fail(`APP_URL (${appUrl}) et BETTER_AUTH_URL (${authUrl}) different : les cookies seront rejetes`)
}

// --- rapport ---------------------------------------------------------------
const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  const mark = check.ok ? (check.warn ? '!' : '✓') : '✗'
  const stream = check.ok ? process.stdout : process.stderr
  stream.write(`  ${mark} ${check.message}\n`)
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} probleme(s) : deploiement deconseille.\n`)
  process.exit(1)
}

process.stdout.write(
  `\nEnvironnement ${production ? 'de production' : 'de developpement'} : pret.\n`,
)
