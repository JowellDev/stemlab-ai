#!/usr/bin/env node
/**
 * Verifie qu'aucun secret ne s'est retrouve dans le bundle client.
 *
 * Le danger n'est pas theorique : il suffit d'importer un module serveur depuis
 * un composant pour que sa valeur parte chez l'utilisateur, et rien dans la
 * compilation ne s'en plaint. On cherche donc les valeurs elles-memes dans les
 * fichiers reellement servis, plutot que de se fier a une convention de nommage.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const CLIENT_DIR = join(import.meta.dirname, '../apps/web/build/client')

/**
 * Variables dont la valeur ne doit jamais apparaitre.
 *
 * Une valeur trop courte ou trop banale produirait de faux positifs : on ignore
 * ce qui fait moins de huit caracteres, faute de pouvoir l'attribuer.
 */
const SECRET_VARS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'ML_WEBHOOK_SECRET',
  'S3_SECRET_ACCESS_KEY',
  'S3_ACCESS_KEY_ID',
  'GOOGLE_CLIENT_SECRET',
  'SENTRY_DSN',
  'METRICS_TOKEN',
]

/**
 * Temoins de nos propres modules serveur.
 *
 * Chercher les *noms* de variables ne marche pas : better-auth embarque un
 * accesseur d'environnement qui les cite tous, sans jamais porter de valeur. On
 * cherche donc des chaines qui n'existent que chez nous — les messages de
 * validation d'`env.server.ts`. Si l'une d'elles apparait, c'est qu'un module
 * serveur entier a suivi un import jusqu'au navigateur.
 */
const SERVER_MARKERS = [
  'DATABASE_URL est requis',
  'BETTER_AUTH_SECRET doit faire au moins 16 caracteres',
  'Configuration invalide',
]

process.loadEnvFile?.(join(import.meta.dirname, '../.env'))

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

let failures = 0
const report = (message) => {
  console.error(`  ✗ ${message}`)
  failures += 1
}

let scanned = 0
const secrets = SECRET_VARS.map((name) => [name, process.env[name]]).filter(
  ([, value]) => typeof value === 'string' && value.length >= 8,
)

if (secrets.length === 0) {
  console.error("Aucun secret a chercher : l'environnement est vide.")
  process.exit(1)
}

for (const file of walk(CLIENT_DIR)) {
  if (!/\.(js|mjs|css|html|json|map|webmanifest)$/.test(file)) continue

  const content = readFileSync(file, 'utf8')
  scanned += 1
  const shown = relative(CLIENT_DIR, file)

  for (const [name, value] of secrets) {
    if (content.includes(value)) report(`${shown} contient la valeur de ${name}`)
  }
  for (const marker of SERVER_MARKERS) {
    if (content.includes(marker)) report(`${shown} embarque un module serveur (« ${marker} »)`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} fuite(s) dans le bundle client.`)
  process.exit(1)
}

console.log(
  `Bundle client : ${scanned} fichiers verifies, aucune trace de ${secrets.length} secrets ` +
    `ni des ${SERVER_MARKERS.length} temoins de modules serveur.`,
)
