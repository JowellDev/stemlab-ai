import { z } from 'zod'

/** Types de stems produits par Demucs. `htdemucs` en produit 4, `htdemucs_6s` les 6. */
export const StemType = z.enum(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'])
export type StemType = z.infer<typeof StemType>

export const FOUR_STEM_TYPES = [
  'vocals',
  'drums',
  'bass',
  'other',
] as const satisfies readonly StemType[]
export const SIX_STEM_TYPES = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
] as const satisfies readonly StemType[]

export const SeparationModel = z.enum(['htdemucs', 'htdemucs_6s'])
export type SeparationModel = z.infer<typeof SeparationModel>

/** Stems attendus pour un modele donne : utilise pour valider une sortie de pipeline. */
export function stemsForModel(model: SeparationModel): readonly StemType[] {
  return model === 'htdemucs_6s' ? SIX_STEM_TYPES : FOUR_STEM_TYPES
}

export const TrackStatus = z.enum(['uploaded', 'queued', 'processing', 'ready', 'failed'])
export type TrackStatus = z.infer<typeof TrackStatus>

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type JobStatus = z.infer<typeof JobStatus>

export const JobType = z.enum(['separate_and_analyze'])
export type JobType = z.infer<typeof JobType>

export const AudioFormat = z.enum(['opus', 'wav', 'mp3', 'flac', 'm4a', 'ogg'])
export type AudioFormat = z.infer<typeof AudioFormat>

/** Formats acceptes a l'upload (cf. phase 4). */
export const UPLOAD_MIME_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
} as const satisfies Record<string, string>

export type UploadMimeType = keyof typeof UPLOAD_MIME_TYPES

export const UploadMimeTypeSchema = z.enum(
  Object.keys(UPLOAD_MIME_TYPES) as [UploadMimeType, ...UploadMimeType[]],
)

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** Cle S3 : pas de slash initial, pas de `..`, ASCII imprimable. */
export const S3Key = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9!_.*'()/-]+$/, 'cle S3 invalide')
  .refine((k) => !k.startsWith('/') && !k.includes('..'), 'cle S3 invalide')
export type S3Key = z.infer<typeof S3Key>

/** SHA-256 hexadecimal minuscule du fichier source : sert de cle d'idempotence. */
export const Checksum = z.string().regex(/^[a-f0-9]{64}$/, 'checksum sha-256 hex attendu')
export type Checksum = z.infer<typeof Checksum>

export const Uuid = z.uuid()

/** Secondes depuis le debut du morceau. */
export const Seconds = z.number().finite().nonnegative()

export const Confidence = z.number().min(0).max(1)
