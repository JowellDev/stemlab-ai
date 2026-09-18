import { UploadRejectedError, type QueuedUpload } from '@stemlab/offline'
import type { ErrorCode } from '@stemlab/contracts'
import { getUploadQueue } from '~/lib/offline.client'
import { UploadError, uploadTrack } from '~/lib/upload.client'

/**
 * Etat de la file d'envoi differee, partage par toute l'application.
 *
 * Un magasin externe plutot qu'un contexte React : la file se vide toute seule
 * au retour du reseau, hors de tout rendu, et plusieurs vues doivent en voir le
 * meme etat sans qu'aucune ne soit proprietaire.
 */

export interface UploadQueueState {
  readonly items: readonly QueuedUpload[]
  readonly flushing: boolean
  /** Dernier refus definitif, a montrer une fois puis oublier. */
  readonly rejected: string | null
}

const EMPTY: UploadQueueState = { items: [], flushing: false, rejected: null }

let state: UploadQueueState = EMPTY
const listeners = new Set<() => void>()
let started = false
/** Rappel declenche apres chaque envoi reussi, pour rafraichir la bibliotheque. */
let onSent: (() => void) | null = null

/**
 * Codes qui ne meritent pas d'etre reessayes.
 *
 * Tout le reste — reseau coupe, serveur en vrac, session a renouveler — peut
 * passer plus tard, et le fichier reste en attente.
 */
const PERMANENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'bad_request',
  'forbidden',
  'not_found',
  'payload_too_large',
  'unsupported_media_type',
  'quota_exceeded',
])

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): UploadQueueState {
  return state
}

export function getServerSnapshot(): UploadQueueState {
  return EMPTY
}

export function setOnSent(callback: (() => void) | null): void {
  onSent = callback
}

/** Met un fichier en attente et tente aussitot de le partir, si le reseau est la. */
export async function enqueue(file: File): Promise<void> {
  const queue = await getUploadQueue()
  if (!queue) throw new Error('La mise en attente est indisponible sur ce navigateur.')

  await queue.enqueue(file)
  await refresh()
  if (navigator.onLine) void flush()
}

export async function refresh(): Promise<void> {
  const queue = await getUploadQueue()
  publish({ items: queue ? await queue.list() : [] })
}

export async function remove(id: string): Promise<void> {
  const queue = await getUploadQueue()
  if (!queue) return
  await queue.remove(id)
  await refresh()
}

export function dismissRejection(): void {
  publish({ rejected: null })
}

export async function flush(): Promise<void> {
  if (state.flushing) return

  const queue = await getUploadQueue()
  if (!queue) return

  publish({ flushing: true })
  try {
    const report = await queue.flush(async (_item, file) => {
      try {
        await uploadTrack(file)
      } catch (error) {
        if (error instanceof UploadError && PERMANENT.has(error.code as ErrorCode)) {
          throw new UploadRejectedError(error.message)
        }
        throw error
      }
    })

    publish({
      items: await queue.list(),
      rejected: report.rejected[0]?.reason ?? null,
    })
    if (report.sent.length > 0) onSent?.()
  } finally {
    publish({ flushing: false })
  }
}

function start(): void {
  if (started || typeof globalThis.addEventListener !== 'function') return
  started = true

  void refresh()
  // Le retour du reseau est le seul signal fiable : un minuteur reveillerait
  // l'appareil pour rien la plupart du temps.
  globalThis.addEventListener('online', () => void flush())
  if (navigator.onLine) void flush()
}

function publish(patch: Partial<UploadQueueState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}
