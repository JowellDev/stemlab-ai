#!/usr/bin/env node
/**
 * Applique la politique CORS du seau.
 *
 * L'audio ne transite jamais par l'application : le navigateur depose et
 * recupere les fichiers directement sur le stockage objet. Ce sont donc des
 * requetes inter-origines, et sans politique CORS le navigateur les refuse
 * avant meme de les emettre — l'envoi echoue sans qu'aucune trace n'apparaisse
 * cote serveur.
 *
 * MinIO et SeaweedFS sont permissifs par defaut, ce qui masque le probleme en
 * developpement. R2 ne l'est pas : la politique doit y etre posee explicitement,
 * une fois, avant la premiere mise en production.
 *
 * Usage :
 *   node scripts/ensure-cors.mjs                 # applique
 *   node scripts/ensure-cors.mjs --show          # affiche la politique en place
 */
import { join } from 'node:path'
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3'

process.loadEnvFile?.(join(import.meta.dirname, '../.env'))

const BUCKET = requireEnv('S3_BUCKET')

/**
 * Origines autorisees a deposer et lire.
 *
 * `APP_URL` en production, plus les adresses de developpement. Une politique en
 * `*` laisserait n'importe quel site utiliser une URL presignee interceptee ;
 * elles expirent, mais la fenetre suffirait.
 */
const ORIGINS = [
  process.env.APP_URL,
  ...(process.env.S3_EXTRA_ORIGINS ?? '').split(',').map((value) => value.trim()),
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
  'http://127.0.0.1:3200',
].filter((value) => typeof value === 'string' && value.length > 0)

const RULES = [
  {
    AllowedOrigins: [...new Set(ORIGINS)],
    // `PUT` pour le depot, `GET` pour la lecture, `HEAD` pour les sondes.
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    // Le navigateur pose `content-type` sur un depot presigne ; `range` sert a
    // la lecture partielle d'un stem.
    AllowedHeaders: ['content-type', 'content-length', 'range', 'if-match'],
    // `etag` permet de verifier un depot ; `content-length` d'afficher une
    // progression de telechargement.
    ExposeHeaders: ['etag', 'content-length', 'content-range', 'accept-ranges'],
    MaxAgeSeconds: 3600,
  },
]

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || 'auto',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  credentials: {
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

if (process.argv.includes('--show')) {
  await show()
} else {
  await apply()
  await show()
}

async function apply() {
  await s3.send(
    new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: { CORSRules: RULES } }),
  )
  console.log(`Politique CORS appliquee sur « ${BUCKET} ».`)
}

async function show() {
  try {
    const current = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }))
    for (const rule of current.CORSRules ?? []) {
      console.log(`  origines : ${(rule.AllowedOrigins ?? []).join(', ')}`)
      console.log(`  methodes : ${(rule.AllowedMethods ?? []).join(', ')}`)
      console.log(`  exposes  : ${(rule.ExposeHeaders ?? []).join(', ')}`)
    }
  } catch (error) {
    // Certains stockages compatibles n'implementent pas la lecture de la
    // politique : l'absence de reponse ne veut pas dire que rien n'est pose.
    console.log(`  (politique illisible sur ce stockage : ${describe(error)})`)
  }
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} est requis.`)
    process.exit(1)
  }
  return value
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
