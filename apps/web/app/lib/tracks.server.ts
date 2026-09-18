import {
  type CreateJobResponse,
  MAX_UPLOAD_BYTES,
  StemlabError,
  UPLOAD_MIME_TYPES,
  type UploadInitRequest,
  type UploadInitResponse,
  type UploadMimeType,
} from '@stemlab/contracts'
import { db } from './db.server'
import { env } from './env.server'
import { createJob } from './ml.server'
import {
  UPLOAD_URL_TTL_SECONDS,
  deleteObjects,
  presignUpload,
  trackSourceKey,
  trackStemsPrefix,
} from './s3.server'
import type { SessionUser } from './session.server'

/**
 * Regles metier des morceaux.
 *
 * Tout ce qui touche a la base vit ici plutot que dans les routes : une route est
 * un adaptateur HTTP, pas un endroit ou raisonner sur des quotas ou des etats.
 */

/** Titre deduit du nom de fichier, faute de metadonnees a ce stade. */
export function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '')
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 200) || 'Sans titre'
}

export function extensionFor(contentType: UploadMimeType): string {
  return UPLOAD_MIME_TYPES[contentType]
}

/**
 * Prepare un envoi : cree le morceau et signe l'URL de depot.
 *
 * Si l'utilisateur possede deja ce fichier avec ce modele, rien n'est cree — on
 * renvoie le morceau existant. Le controle porte sur le checksum, pas sur le nom :
 * deux fichiers identiques renommes restent le meme morceau.
 */
export async function initUpload(
  user: SessionUser,
  input: UploadInitRequest,
): Promise<UploadInitResponse> {
  if (input.bytes > Math.min(MAX_UPLOAD_BYTES, env.MAX_UPLOAD_BYTES)) {
    throw new StemlabError('payload_too_large', 'Le fichier depasse la taille maximale de 100 Mo.')
  }

  const existing = await db.track.findUnique({
    where: {
      userId_checksum_model: { userId: user.id, checksum: input.checksum, model: input.model },
    },
    select: { id: true, status: true },
  })

  if (existing && existing.status !== 'failed') {
    return {
      trackId: existing.id,
      uploadUrl: 'about:blank',
      requiredHeaders: {},
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      alreadyExists: true,
    }
  }

  const extension = extensionFor(input.contentType)
  const track = existing
    ? await db.track.update({
        where: { id: existing.id },
        data: {
          status: 'uploaded',
          progress: 0,
          stage: null,
          errorMessage: null,
          sourceBytes: input.bytes,
          contentType: input.contentType,
        },
        select: { id: true },
      })
    : await db.track.create({
        data: {
          userId: user.id,
          title: titleFromFilename(input.filename),
          checksum: input.checksum,
          model: input.model,
          status: 'uploaded',
          sourceBytes: input.bytes,
          contentType: input.contentType,
        },
        select: { id: true },
      })

  // La cle contient l'identifiant du morceau : elle ne peut donc etre calculee
  // qu'apres la creation en base.
  const key = trackSourceKey(user.id, track.id, extension)
  await db.track.update({ where: { id: track.id }, data: { sourceKey: key } })

  const presigned = await presignUpload({
    key,
    contentType: input.contentType,
    bytes: input.bytes,
  })

  return {
    trackId: track.id,
    uploadUrl: presigned.url,
    requiredHeaders: presigned.requiredHeaders,
    expiresAt: presigned.expiresAt.toISOString(),
    alreadyExists: false,
  }
}

/** Confirme l'envoi et met le morceau en file de traitement. */
export async function completeUpload(user: SessionUser, trackId: string): Promise<void> {
  const track = await db.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true, checksum: true, model: true, sourceKey: true, status: true },
  })

  if (!track) throw new StemlabError('not_found', 'Morceau introuvable.')
  if (!track.sourceKey) throw new StemlabError('conflict', "Aucun envoi n'a ete prepare.")
  if (track.status === 'queued' || track.status === 'processing') return

  // Le morceau est marque « en file » AVANT l'appel au service ML. Le service peut
  // repondre par un resultat deduplique, dont le webhook de succes arrive alors
  // pendant cet appel : marquer apres coup ecraserait un morceau deja pret.
  await db.track.updateMany({
    where: { id: track.id, status: { in: ['uploaded', 'failed'] } },
    data: { status: 'queued', progress: 0, stage: null, errorMessage: null },
  })

  let response: CreateJobResponse
  try {
    response = await createJob({
      trackId: track.id,
      sourceKey: track.sourceKey,
      checksum: track.checksum,
      model: track.model,
      outputPrefix: trackStemsPrefix(user.id, track.id),
      callbackUrl: env.ML_WEBHOOK_URL,
    })
  } catch (error) {
    // La mise en file a echoue : le morceau ne doit pas rester bloque « en file »
    // alors que rien ne le traitera jamais.
    await db.track.updateMany({
      where: { id: track.id, status: 'queued' },
      data: {
        status: 'failed',
        errorMessage: "Le service d'analyse est injoignable. Reessayez.",
      },
    })
    throw error
  }

  await db.job.upsert({
    where: { id: response.jobId },
    create: {
      id: response.jobId,
      trackId: track.id,
      status: response.deduplicated ? 'succeeded' : 'queued',
    },
    update: { status: response.deduplicated ? 'succeeded' : 'queued', errorMessage: null },
  })
}

/**
 * Supprime un morceau, ses stems, et les objets S3 correspondants.
 *
 * Les objets partent avant la ligne : si la suppression S3 echoue, le morceau reste
 * visible et l'utilisateur peut reessayer. L'inverse laisserait des octets payants
 * sans aucun moyen de les retrouver.
 */
export async function deleteTrack(user: SessionUser, trackId: string): Promise<void> {
  const track = await db.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true, sourceKey: true, stems: { select: { key: true } } },
  })
  if (!track) throw new StemlabError('not_found', 'Morceau introuvable.')

  const keys = [track.sourceKey, ...track.stems.map((stem) => stem.key)].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  )

  await deleteObjects(keys)
  await db.track.delete({ where: { id: track.id } })
}
