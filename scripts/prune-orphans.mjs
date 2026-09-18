#!/usr/bin/env node
/**
 * Supprime les objets S3 qui n'appartiennent plus a aucun morceau.
 *
 * Un envoi abandonne en cours de route laisse son original sur le stockage sans
 * qu'aucune ligne ne le reference : personne ne le reclamera jamais, et il sera
 * facture indefiniment. La suppression d'un morceau, elle, nettoie deja ses
 * objets — ceci rattrape ce qui a echappe au chemin nominal.
 *
 * Les objets recents sont epargnes : un envoi en cours n'a pas encore sa ligne
 * confirmee, et le supprimer casserait un depot legitime.
 *
 * Usage : node scripts/prune-orphans.mjs [--apply]
 */
import { join } from 'node:path'
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'

process.loadEnvFile?.(join(import.meta.dirname, '../.env'))

const GRACE_HOURS = Number(process.env.ORPHAN_GRACE_HOURS ?? 24)

/**
 * Les objets d'un morceau vivent sous `users/<userId>/tracks/<trackId>/…`.
 *
 * Le segment utilisateur compte : quand un compte disparait, ses morceaux
 * disparaissent en cascade dans la base, et tous ses objets deviennent
 * orphelins d'un coup.
 */
const PREFIX = 'users/'

function trackIdOf(key) {
  const parts = key.split('/')
  return parts[0] === 'users' && parts[2] === 'tracks' ? parts[3] : null
}
const BUCKET = process.env.S3_BUCKET
const apply = process.argv.includes('--apply')

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

// `pg` en direct plutot que le client Prisma : celui-ci est genere en
// TypeScript et ne s'importe pas depuis un script Node nu. Une seule colonne
// suffit ici, et la requete ne changera pas.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
const { rows } = await db.query('SELECT id FROM track')
await db.end()

const known = new Set(rows.map((row) => row.id))

const cutoff = Date.now() - GRACE_HOURS * 60 * 60 * 1000
const orphans = []
let total = 0
let token

do {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }),
  )

  for (const object of page.Contents ?? []) {
    total += 1
    const trackId = trackIdOf(object.Key)
    // Une cle hors convention n'est pas un orphelin : elle est inconnue. La
    // supprimer sur cette seule base effacerait tout ce que le jour ou l'on
    // ajoutera un autre prefixe aura mis la.
    if (!trackId || known.has(trackId)) continue
    if ((object.LastModified?.getTime() ?? 0) >= cutoff) continue
    orphans.push(object)
  }

  token = page.NextContinuationToken
} while (token)

const bytes = orphans.reduce((sum, o) => sum + (o.Size ?? 0), 0)
console.log(
  `${total} objets, ${known.size} morceaux connus, ` +
    `${orphans.length} orphelins de plus de ${GRACE_HOURS} h (${(bytes / 1024 / 1024).toFixed(1)} Mo)`,
)

if (orphans.length === 0) process.exit(0)

if (!apply) {
  for (const object of orphans.slice(0, 20)) console.log(`  ${object.Key}`)
  if (orphans.length > 20) console.log(`  … et ${orphans.length - 20} autres`)
  console.log('\nRelancez avec --apply pour supprimer.')
  process.exit(0)
}

// S3 limite chaque suppression groupee a mille cles.
for (let i = 0; i < orphans.length; i += 1000) {
  const lot = orphans.slice(i, i + 1000)
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: lot.map((o) => ({ Key: o.Key })) },
    }),
  )
}

console.log(`${orphans.length} objets supprimes.`)
