import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env.server'

/**
 * Stockage objet.
 *
 * L'audio ne transite jamais par l'application : le navigateur envoie et recupere
 * les fichiers directement, par URL presignee. Le serveur ne fait que signer.
 */

const client = new S3Client({
  endpoint: env.S3_ENDPOINT || undefined,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },

  // Depuis fin 2024, le SDK v3 joint par defaut un checksum CRC32 a chaque envoi.
  // C'est utile pour ses propres requetes, mais fatal pour une URL presignee : la
  // signature exige alors un en-tete que le navigateur ne produit pas, et le
  // stockage rejette le depot (`BadDigest`). `WHEN_REQUIRED` ne l'ajoute que
  // lorsque l'operation l'impose vraiment.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

/** Duree de vie d'une URL d'envoi : assez pour televerser 100 Mo sur une ligne lente. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60

/** Duree de vie d'une URL de lecture : courte, elle est renouvelee a chaque chargement. */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60

export function trackSourceKey(userId: string, trackId: string, extension: string): string {
  return `users/${userId}/tracks/${trackId}/original.${extension}`
}

export function trackStemsPrefix(userId: string, trackId: string): string {
  return `users/${userId}/tracks/${trackId}/stems`
}

export interface PresignedUpload {
  url: string
  requiredHeaders: Record<string, string>
  expiresAt: Date
}

/**
 * URL d'envoi direct.
 *
 * `ContentType` et `ContentLength` sont inclus dans la signature : le navigateur doit
 * les repeter a l'identique, et ne peut donc pas deposer autre chose, ni plus gros,
 * que ce que le serveur a autorise.
 */
export async function presignUpload(options: {
  key: string
  contentType: string
  bytes: number
}): Promise<PresignedUpload> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: options.key,
    ContentType: options.contentType,
    ContentLength: options.bytes,
  })

  const url = await getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS })

  return {
    url,
    requiredHeaders: {
      'content-type': options.contentType,
      'content-length': String(options.bytes),
    },
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
  }
}

/**
 * URL de lecture, toujours signee et toujours expirante.
 *
 * Il n'existe volontairement aucun chemin qui rende une adresse publique
 * permanente. Un morceau appartient a son proprietaire, et une adresse qui
 * n'expire pas est une adresse partageable — ce que le service promet de ne pas
 * permettre.
 *
 * Mettre un CDN devant ces fichiers demanderait de les signer au niveau du CDN :
 * une signature S3 porte sur l'hote, et reecrire l'hote l'invalide. Ce n'est pas
 * implemente, et le seau ne doit donc jamais etre rendu public.
 */
export async function presignDownload(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key })
  return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS })
}

/** Supprime plusieurs objets. Utilise a la suppression d'un morceau. */
export async function deleteObjects(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  // `DeleteObjects` plafonne a 1000 cles par appel ; un morceau en compte au plus sept.
  await client.send(
    new DeleteObjectsCommand({
      Bucket: env.S3_BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  )
}

export { client as s3Client }
