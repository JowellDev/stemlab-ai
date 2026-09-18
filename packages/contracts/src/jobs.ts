import { z } from 'zod'
import { Lyrics } from './lyrics.js'
import { AnalysisResult, Waveform } from './music.js'
import {
  AudioFormat,
  Checksum,
  JobStatus,
  JobType,
  S3Key,
  SeparationModel,
  Seconds,
  StemType,
  Uuid,
} from './primitives.js'

// ---------------------------------------------------------------------------
// BFF -> service ML
// ---------------------------------------------------------------------------

export const CreateJobRequest = z.object({
  /** Identifiant du morceau cote BFF : renvoye tel quel dans le webhook. */
  trackId: Uuid,
  /** Objet source deja depose sur S3 par le client via URL presignee. */
  sourceKey: S3Key,
  /** SHA-256 du fichier source : cle d'idempotence du pipeline. */
  checksum: Checksum,
  model: SeparationModel.default('htdemucs'),
  /** Prefixe S3 sous lequel le worker ecrit les stems. */
  outputPrefix: S3Key,
  /** URL appelee a la completion ou a l'echec (signee HMAC). */
  callbackUrl: z.url(),
})
export type CreateJobRequest = z.infer<typeof CreateJobRequest>

export const CreateJobResponse = z.object({
  jobId: Uuid,
  status: JobStatus,
  /** true si le resultat provenait deja du cache d'idempotence (checksum connu). */
  deduplicated: z.boolean(),
})
export type CreateJobResponse = z.infer<typeof CreateJobResponse>

export const JobProgress = z.object({
  jobId: Uuid,
  trackId: Uuid,
  type: JobType,
  status: JobStatus,
  /** 0-100. Monotone croissante au sein d'un meme essai. */
  progress: z.number().int().min(0).max(100),
  /** Etape lisible par un humain, ex. "separation 2/4". */
  stage: z.string().max(120).nullable(),
  error: z.string().max(2000).nullable(),
  attempt: z.number().int().min(0),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})
export type JobProgress = z.infer<typeof JobProgress>

// ---------------------------------------------------------------------------
// Resultat du pipeline
// ---------------------------------------------------------------------------

export const StemArtifact = z.object({
  type: StemType,
  key: S3Key,
  format: AudioFormat,
  bytes: z.number().int().positive(),
  /** Peaks propres a ce stem, pour le dessin de sa piste. */
  waveform: Waveform,
})
export type StemArtifact = z.infer<typeof StemArtifact>

export const PipelineResult = z.object({
  durationSeconds: Seconds,
  sampleRate: z.number().int().positive(),
  channels: z.number().int().min(1).max(2),
  model: SeparationModel,
  stems: z.array(StemArtifact).min(1),
  analysis: AnalysisResult,
  /** Peaks du mix complet, pour la barre de transport. */
  waveform: Waveform,
  /** Absentes pour un morceau instrumental, ou quand la transcription est desactivee. */
  lyrics: Lyrics.nullish(),
  /** Temps de traitement mesure cote worker, pour le suivi de cout. */
  processingSeconds: Seconds,
})
export type PipelineResult = z.infer<typeof PipelineResult>

// ---------------------------------------------------------------------------
// Webhook worker -> BFF
// ---------------------------------------------------------------------------

export const JobCallbackSuccess = z.object({
  event: z.literal('job.succeeded'),
  jobId: Uuid,
  trackId: Uuid,
  checksum: Checksum,
  result: PipelineResult,
})

export const JobCallbackFailure = z.object({
  event: z.literal('job.failed'),
  jobId: Uuid,
  trackId: Uuid,
  checksum: Checksum,
  error: z.object({
    code: z.string().max(64),
    message: z.string().max(2000),
    retryable: z.boolean(),
  }),
})

export const JobCallbackProgress = z.object({
  event: z.literal('job.progress'),
  jobId: Uuid,
  trackId: Uuid,
  progress: z.number().int().min(0).max(100),
  stage: z.string().max(120),
})

export const JobCallback = z.discriminatedUnion('event', [
  JobCallbackSuccess,
  JobCallbackFailure,
  JobCallbackProgress,
])
export type JobCallback = z.infer<typeof JobCallback>
export type JobCallbackSuccess = z.infer<typeof JobCallbackSuccess>
export type JobCallbackFailure = z.infer<typeof JobCallbackFailure>
