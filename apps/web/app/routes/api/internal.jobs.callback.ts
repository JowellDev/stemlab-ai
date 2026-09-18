import {
  JobCallback,
  type JobCallbackSuccess,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from '@stemlab/contracts'
import { db } from '~/lib/db.server'
import { env } from '~/lib/env.server'
import type { Route } from './+types/internal.jobs.callback'
import { logger } from '~/lib/logger.server'

/**
 * Webhook du service ML.
 *
 * C'est le seul chemin par lequel un resultat entre en base : le worker n'y touche
 * jamais lui-meme. La signature est verifiee sur le corps **brut**, avant toute
 * deserialisation — signer une representation reserialisee ne prouverait rien.
 */
export async function action({ request }: Route.ActionArgs) {
  const raw = await request.text()

  const verification = await verifySignature({
    secret: env.ML_WEBHOOK_SECRET,
    body: raw,
    signature: request.headers.get(SIGNATURE_HEADER),
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    toleranceSeconds: env.ML_WEBHOOK_TOLERANCE_SECONDS,
  })

  if (!verification.ok) {
    logger.warn('webhook refuse', { reason: verification.reason })
    return Response.json({ code: 'unauthorized', message: 'signature invalide' }, { status: 401 })
  }

  // Signature valide ne veut pas dire JSON valide : un corps tronque en cours
  // de route passerait la verification et ferait echouer l'analyse.
  const parsed = JobCallback.safeParse(parseJson(raw))
  if (!parsed.success) {
    return Response.json({ code: 'bad_request', message: 'charge invalide' }, { status: 400 })
  }

  const callback = parsed.data

  // Le morceau doit exister et le job lui appartenir : un webhook valide mais
  // portant un identifiant inconnu ne doit rien creer.
  const track = await db.track.findUnique({
    where: { id: callback.trackId },
    select: { id: true, userId: true },
  })
  if (!track) {
    return Response.json({ code: 'not_found', message: 'morceau inconnu' }, { status: 404 })
  }

  switch (callback.event) {
    case 'job.progress':
      await applyProgress(callback.jobId, track.id, callback.progress, callback.stage)
      break
    case 'job.failed':
      await applyFailure(callback.jobId, track.id, callback.error.message)
      break
    case 'job.succeeded':
      await applySuccess(callback)
      break
  }

  return Response.json({ received: true })
}

async function applyProgress(
  jobId: string,
  trackId: string,
  progress: number,
  stage: string,
): Promise<void> {
  await db.$transaction([
    db.job.upsert({
      where: { id: jobId },
      create: { id: jobId, trackId, status: 'running', progress, stage, startedAt: new Date() },
      update: { status: 'running', progress, stage },
    }),
    db.track.update({
      where: { id: trackId },
      data: { status: 'processing', progress, stage },
    }),
  ])
}

async function applyFailure(jobId: string, trackId: string, message: string): Promise<void> {
  await db.$transaction([
    db.job.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        trackId,
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      },
      update: { status: 'failed', errorMessage: message, finishedAt: new Date() },
    }),
    db.track.update({
      where: { id: trackId },
      data: { status: 'failed', errorMessage: message, stage: null },
    }),
  ])
}

/**
 * Enregistre un resultat complet.
 *
 * Tout passe dans une seule transaction : un morceau `ready` sans ses stems, ou avec
 * une analyse d'un traitement precedent, serait pire qu'un morceau en echec.
 * Les stems sont remplaces plutot que fusionnes — un nouveau traitement peut en
 * produire un nombre different.
 */
async function applySuccess(callback: JobCallbackSuccess): Promise<void> {
  const { result } = callback

  await db.$transaction([
    db.stem.deleteMany({ where: { trackId: callback.trackId } }),

    db.stem.createMany({
      data: result.stems.map((stem) => ({
        trackId: callback.trackId,
        type: stem.type,
        key: stem.key,
        format: stem.format,
        bytes: stem.bytes,
        waveform: stem.waveform,
      })),
    }),

    db.analysis.upsert({
      where: { trackId: callback.trackId },
      create: {
        trackId: callback.trackId,
        key: result.analysis.key,
        mode: result.analysis.mode,
        keyConfidence: result.analysis.keyConfidence,
        bpm: result.analysis.bpm,
        firstBeatOffset: result.analysis.firstBeatOffset,
        timeSignature: result.analysis.timeSignature,
        chords: result.analysis.chords,
        beats: result.analysis.beats,
      },
      update: {
        key: result.analysis.key,
        mode: result.analysis.mode,
        keyConfidence: result.analysis.keyConfidence,
        bpm: result.analysis.bpm,
        firstBeatOffset: result.analysis.firstBeatOffset,
        timeSignature: result.analysis.timeSignature,
        chords: result.analysis.chords,
        beats: result.analysis.beats,
      },
    }),

    db.job.upsert({
      where: { id: callback.jobId },
      create: {
        id: callback.jobId,
        trackId: callback.trackId,
        status: 'succeeded',
        progress: 100,
        processingSeconds: result.processingSeconds,
        finishedAt: new Date(),
      },
      update: {
        status: 'succeeded',
        progress: 100,
        stage: null,
        errorMessage: null,
        processingSeconds: result.processingSeconds,
        finishedAt: new Date(),
      },
    }),

    db.track.update({
      where: { id: callback.trackId },
      data: {
        status: 'ready',
        progress: 100,
        stage: null,
        errorMessage: null,
        durationSeconds: result.durationSeconds,
        waveform: result.waveform,
      },
    }),
  ])
}


function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
