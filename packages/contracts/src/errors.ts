import { z } from 'zod'

/** Codes d'erreur transverses : le client les traduit en messages utilisateur. */
export const ErrorCode = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'quota_exceeded',
  'upstream_unavailable',
  'internal_error',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  /** Champs invalides, quand l'erreur vient d'une validation de schema. */
  fields: z.record(z.string(), z.array(z.string())).optional(),
})
export type ApiError = z.infer<typeof ApiError>

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  quota_exceeded: 402,
  upstream_unavailable: 503,
  internal_error: 500,
}

/** Erreur typee qui traverse les frontieres HTTP sans perdre son code. */
export class StemlabError extends Error {
  readonly code: ErrorCode
  readonly fields: Record<string, string[]> | undefined

  constructor(code: ErrorCode, message: string, fields?: Record<string, string[]>) {
    super(message)
    this.name = 'StemlabError'
    this.code = code
    this.fields = fields
  }

  get status(): number {
    return HTTP_STATUS_BY_ERROR_CODE[this.code]
  }

  toJSON(): ApiError {
    return this.fields
      ? { code: this.code, message: this.message, fields: this.fields }
      : { code: this.code, message: this.message }
  }
}

export function isStemlabError(value: unknown): value is StemlabError {
  return value instanceof StemlabError
}
