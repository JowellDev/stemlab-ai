#!/usr/bin/env node
/**
 * Depose une sauvegarde sur le stockage objet et applique la retention.
 *
 * Separe de la production du dump a dessein : `pg_dump` demande un client
 * PostgreSQL, que toutes les machines n'ont pas, alors que le depot et la
 * retention — la partie ou l'on perd reellement des donnees si l'on se trompe —
 * se verifient partout, avec n'importe quels octets sur l'entree standard.
 *
 * Usage :
 *   pg_dump "$DATABASE_URL" -Fc | gzip | node scripts/backup-store.mjs
 *   node scripts/backup-store.mjs --list
 *   node scripts/backup-store.mjs --prune
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

process.loadEnvFile?.(join(import.meta.dirname, '../.env'))

const PREFIX = process.env.BACKUP_PREFIX ?? 'backups/'
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30)
const BUCKET = requireEnv('S3_BUCKET')

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  credentials: {
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
  },
  // Le calcul de checksum par defaut du SDK v3 casse les depots S3-compatibles.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const mode = process.argv[2] ?? '--store'

if (mode === '--list') await list().then(print)
else if (mode === '--prune') await prune().then((n) => console.log(`${n} sauvegarde(s) supprimee(s)`))
else await store()

async function store() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  if (body.byteLength === 0) {
    console.error('Entree vide : rien a sauvegarder. Le dump a-t-il echoue ?')
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const key = `${PREFIX}${stamp}.sql.gz`
  const digest = createHash('sha256').update(body).digest('hex')

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      // L'empreinte permet de verifier une restauration sans refaire le dump.
      Metadata: { sha256: digest, bytes: String(body.byteLength) },
    }),
  )

  console.log(`${key} — ${(body.byteLength / 1024).toFixed(1)} Ko — sha256 ${digest.slice(0, 16)}…`)

  const removed = await prune()
  if (removed > 0) console.log(`retention : ${removed} sauvegarde(s) au-dela de ${RETENTION_DAYS} j`)
}

async function list() {
  const objects = []
  let token

  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }),
    )
    objects.push(...(page.Contents ?? []))
    token = page.NextContinuationToken
  } while (token)

  return objects.sort((a, b) => (a.Key < b.Key ? 1 : -1))
}

/**
 * Supprime les sauvegardes trop anciennes, mais jamais la derniere.
 *
 * Une retention qui vide entierement le seau apres une longue interruption
 * transformerait une panne de sauvegarde en perte de sauvegarde.
 */
async function prune() {
  const objects = await list()
  if (objects.length <= 1) return 0

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const expired = objects.slice(1).filter((o) => (o.LastModified?.getTime() ?? 0) < cutoff)
  if (expired.length === 0) return 0

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: expired.map((o) => ({ Key: o.Key })) },
    }),
  )

  return expired.length
}

function print(objects) {
  if (objects.length === 0) {
    console.log('aucune sauvegarde')
    return
  }
  for (const object of objects) {
    const age = ((Date.now() - object.LastModified.getTime()) / 86_400_000).toFixed(1)
    console.log(
      `${object.Key}  ${(object.Size / 1024).toFixed(1)} Ko  ${age} j`.replace(/\s+/g, ' '),
    )
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
