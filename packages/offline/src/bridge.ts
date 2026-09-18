import type { StemType } from '@stemlab/contracts'
import type { OfflineStore, StemPayload } from './store.js'

/**
 * Pont entre le stockage hors-ligne et le lecteur.
 *
 * Le lecteur ne sait pas d'ou viennent ses stems : il recoit des URL et un
 * `fetch`. Il suffit donc de lui donner des URL d'un schema a nous, et un `fetch`
 * qui les resout depuis le stockage. Rien dans le moteur audio n'a besoin de
 * connaitre l'existence du mode hors-ligne.
 */

export const OFFLINE_SCHEME = 'stemlab-offline:'

export function offlineUrl(trackId: string, type: StemType): string {
  return `${OFFLINE_SCHEME}//${trackId}/${type}`
}

export function parseOfflineUrl(url: string): { trackId: string; type: StemType } | null {
  if (!url.startsWith(OFFLINE_SCHEME)) return null
  const [trackId, type] = url.slice(`${OFFLINE_SCHEME}//`.length).split('/')
  if (!trackId || !type) return null
  return { trackId, type: type as StemType }
}

/** Type MIME par format, pour que la reponse soit decodable telle quelle. */
const CONTENT_TYPES: Record<string, string> = {
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
}

/**
 * `fetch` qui sert les URL hors-ligne depuis le stockage, et delegue le reste.
 *
 * Toute autre URL passe au `fetch` du navigateur : une meme instance de lecteur
 * peut donc melanger des pistes stockees et des pistes distantes.
 */
export function createOfflineFetch(store: OfflineStore, fallback: typeof fetch = fetch): typeof fetch {
  return async function offlineFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsed = parseOfflineUrl(url)
    if (!parsed) return fallback(input, init)

    const data = await store.readStem(parsed.trackId, parsed.type)
    if (!data) {
      // Le morceau a pu etre evince entre l'affichage et la lecture : une 404
      // laisse le lecteur signaler l'echec comme pour n'importe quelle piste.
      return new Response(null, { status: 404, statusText: 'piste absente du stockage' })
    }

    void store.touch(parsed.trackId)

    const extension = url.split('.').pop() ?? ''
    return new Response(new Uint8Array(data).buffer as ArrayBuffer, {
      status: 200,
      headers: { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' },
    })
  }
}

export interface DownloadableStem {
  readonly type: StemType
  readonly url: string
  readonly format: string
}

export interface DownloadProgress {
  readonly loaded: number
  readonly total: number
  readonly type: StemType
}

export interface DownloadOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: DownloadProgress) => void
  readonly fetchImpl?: typeof fetch
}

export class OfflineDownloadError extends Error {
  readonly stemType: StemType

  constructor(stemType: StemType, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OfflineDownloadError'
    this.stemType = stemType
  }
}

/**
 * Telecharge un morceau et le range dans le stockage.
 *
 * Les stems sont recuperes en serie : les telecharger de front saturerait une
 * connexion mobile et rendrait la progression illisible.
 */
export async function downloadTrack(
  store: OfflineStore,
  track: { trackId: string; title: string },
  stems: readonly DownloadableStem[],
  options: DownloadOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const payloads: StemPayload[] = []

  for (const [index, stem] of stems.entries()) {
    let response: Response
    try {
      response = await fetchImpl(stem.url, options.signal ? { signal: options.signal } : {})
    } catch (cause) {
      throw new OfflineDownloadError(stem.type, `telechargement de ${stem.type} impossible`, {
        cause,
      })
    }

    if (!response.ok) {
      throw new OfflineDownloadError(
        stem.type,
        `telechargement de ${stem.type} : HTTP ${response.status}`,
      )
    }

    payloads.push({
      type: stem.type,
      format: stem.format,
      data: new Uint8Array(await response.arrayBuffer()),
    })

    options.onProgress?.({ loaded: index + 1, total: stems.length, type: stem.type })
  }

  await store.save(track, payloads)
}
