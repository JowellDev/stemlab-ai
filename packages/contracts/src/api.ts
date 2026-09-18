import { z } from 'zod'
import { AnalysisResult, Waveform } from './music.js'
import {
  AudioFormat,
  Checksum,
  MAX_UPLOAD_BYTES,
  SeparationModel,
  Seconds,
  StemType,
  TrackStatus,
  UploadMimeTypeSchema,
  Uuid,
} from './primitives.js'

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export const UploadInitRequest = z.object({
  filename: z.string().min(1).max(255),
  contentType: UploadMimeTypeSchema,
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  checksum: Checksum,
  model: SeparationModel.default('htdemucs'),
})
export type UploadInitRequest = z.infer<typeof UploadInitRequest>

export const UploadInitResponse = z.object({
  trackId: Uuid,
  /** URL presignee PUT : le navigateur envoie directement vers S3. */
  uploadUrl: z.url(),
  /** En-tetes a repeter tels quels sur le PUT, sinon la signature echoue. */
  requiredHeaders: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
  /** true si un morceau identique (meme checksum) existe deja : rien a uploader. */
  alreadyExists: z.boolean(),
})
export type UploadInitResponse = z.infer<typeof UploadInitResponse>

export const UploadCompleteRequest = z.object({ trackId: Uuid })
export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequest>

// ---------------------------------------------------------------------------
// Morceaux
// ---------------------------------------------------------------------------

export const TrackSummary = z.object({
  id: Uuid,
  title: z.string(),
  artist: z.string().nullable(),
  durationSeconds: Seconds.nullable(),
  status: TrackStatus,
  model: SeparationModel,
  progress: z.number().int().min(0).max(100),
  /** Etape en cours, lisible par un humain. `null` hors traitement. */
  stage: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  key: z.string().nullable(),
  mode: z.string().nullable(),
  bpm: z.number().nullable(),
})
export type TrackSummary = z.infer<typeof TrackSummary>

export const StemResource = z.object({
  id: Uuid,
  type: StemType,
  format: AudioFormat,
  bytes: z.number().int().positive(),
  /** URL presignee GET, courte duree de vie. */
  url: z.url(),
  waveform: Waveform,
})
export type StemResource = z.infer<typeof StemResource>

export const TrackDetail = TrackSummary.extend({
  stems: z.array(StemResource),
  analysis: AnalysisResult.nullable(),
  waveform: Waveform.nullable(),
  /** Expiration commune des URLs presignees ci-dessus. */
  urlsExpireAt: z.iso.datetime(),
})
export type TrackDetail = z.infer<typeof TrackDetail>

export const TrackListResponse = z.object({
  tracks: z.array(TrackSummary),
  quota: z.object({
    plan: z.enum(['free', 'pro']),
    used: z.number().int().min(0),
    limit: z.number().int().min(0).nullable(),
    periodEnd: z.iso.datetime().nullable(),
  }),
})
export type TrackListResponse = z.infer<typeof TrackListResponse>

/** Evenement SSE pousse sur la page bibliotheque pendant le traitement. */
export const TrackEvent = z.object({
  trackId: Uuid,
  status: TrackStatus,
  progress: z.number().int().min(0).max(100),
  stage: z.string().nullable(),
  errorMessage: z.string().nullable(),
})
export type TrackEvent = z.infer<typeof TrackEvent>
