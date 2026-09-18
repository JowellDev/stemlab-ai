import {
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME_TYPES,
  UploadInitResponse,
  type SeparationModel,
  type UploadMimeType,
} from '@stemlab/contracts'

/**
 * Envoi d'un fichier, cote navigateur.
 *
 * Le fichier ne passe pas par l'application : elle signe une URL, le navigateur
 * depose directement sur S3. C'est ce qui permet d'accepter 100 Mo sans dimensionner
 * le serveur pour.
 */

export type UploadPhase = 'hashing' | 'preparing' | 'uploading' | 'finishing' | 'done'

export interface UploadProgress {
  phase: UploadPhase
  /** 0-100, uniquement pendant la phase d'envoi. */
  percent: number
}

export class UploadError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'UploadError'
    this.code = code
  }
}

export function isAcceptedType(type: string): type is UploadMimeType {
  return type in UPLOAD_MIME_TYPES
}

/** Formats acceptes, pour l'attribut `accept` du selecteur de fichier. */
export const ACCEPTED_TYPES = Object.keys(UPLOAD_MIME_TYPES).join(',')

export function describeFileError(file: File): string | null {
  if (!isAcceptedType(file.type)) {
    return `Format non pris en charge. Formats acceptes : MP3, WAV, FLAC, M4A, OGG.`
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Fichier trop volumineux (${formatBytes(file.size)}). Maximum : 100 Mo.`
  }
  if (file.size === 0) {
    return 'Le fichier est vide.'
  }
  return null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/**
 * SHA-256 du fichier, qui sert de cle d'idempotence.
 *
 * Le fichier est lu en entier en memoire : `crypto.subtle` n'a pas d'API
 * incrementale. A 100 Mo c'est supportable, y compris sur mobile ; au-dela il
 * faudrait une implementation par blocs.
 */
export async function computeChecksum(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export interface UploadResult {
  trackId: string
  alreadyExists: boolean
}

export async function uploadTrack(
  file: File,
  options: {
    model?: SeparationModel
    onProgress?: (progress: UploadProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<UploadResult> {
  const report = options.onProgress ?? (() => {})

  const invalid = describeFileError(file)
  if (invalid) throw new UploadError('unsupported_media_type', invalid)
  if (!isAcceptedType(file.type)) throw new UploadError('unsupported_media_type', 'Format refuse.')

  report({ phase: 'hashing', percent: 0 })
  const checksum = await computeChecksum(file)

  report({ phase: 'preparing', percent: 0 })
  const init = await postJson('/api/upload/init', {
    filename: file.name,
    contentType: file.type,
    bytes: file.size,
    checksum,
    model: options.model ?? 'htdemucs',
  })
  const prepared = UploadInitResponse.parse(init)

  if (!prepared.alreadyExists) {
    report({ phase: 'uploading', percent: 0 })
    await putWithProgress(prepared.uploadUrl, file, prepared.requiredHeaders, (percent) =>
      report({ phase: 'uploading', percent }),
    )
  }

  report({ phase: 'finishing', percent: 100 })
  await postJson('/api/upload/complete', { trackId: prepared.trackId })

  report({ phase: 'done', percent: 100 })
  return { trackId: prepared.trackId, alreadyExists: prepared.alreadyExists }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (response.ok) return response.json()

  const payload = (await response.json().catch(() => null)) as {
    code?: string
    message?: string
  } | null

  throw new UploadError(
    payload?.code ?? 'internal_error',
    payload?.message ?? `La requete a echoue (HTTP ${response.status}).`,
  )
}

/**
 * `PUT` avec suivi de progression.
 *
 * `fetch` n'expose pas la progression d'envoi ; `XMLHttpRequest` si. C'est la seule
 * raison de son usage ici.
 */
function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onPercent: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url, true)

    for (const [name, value] of Object.entries(headers)) {
      // `content-length` est pose par le navigateur et refuse a l'ecriture.
      if (name.toLowerCase() === 'content-length') continue
      request.setRequestHeader(name, value)
    }

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      onPercent(Math.round((event.loaded / event.total) * 100))
    })

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onPercent(100)
        resolve()
        return
      }
      reject(new UploadError('internal_error', `Le depot a echoue (HTTP ${request.status}).`))
    })

    request.addEventListener('error', () =>
      reject(new UploadError('upstream_unavailable', 'Le depot du fichier a echoue.')),
    )
    request.addEventListener('abort', () =>
      reject(new UploadError('bad_request', 'Envoi interrompu.')),
    )

    request.send(file)
  })
}
