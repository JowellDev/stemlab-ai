import { QuotaExceededError, type FileStorage } from './storage.js'

/**
 * File d'envoi differee.
 *
 * Un fichier choisi sans reseau n'est pas perdu : il est ecrit dans le stockage
 * local et repart des que la connexion revient. Les octets vivent a cote de
 * ceux des morceaux telecharges, dans le meme stockage — vider le site vide les
 * deux, et un manifeste qui survivrait a ses fichiers decrirait des envois
 * fantomes.
 */

export interface QueuedUpload {
  readonly id: string
  readonly filename: string
  readonly contentType: string
  readonly bytes: number
  /** Epoch en millisecondes. La file part du plus ancien. */
  readonly queuedAt: number
  readonly attempts: number
  /** Dernier echec transitoire, a montrer a l'utilisateur. */
  readonly lastError?: string
}

export interface QueueManifest {
  readonly version: 1
  readonly items: readonly QueuedUpload[]
}

export const QUEUE_FILE = 'uploads.json'

export const EMPTY_QUEUE: QueueManifest = { version: 1, items: [] }

/**
 * Plafond de la file, distinct du budget des morceaux telecharges.
 *
 * Un envoi en attente est un fichier source complet : quatre morceaux de 100 Mo
 * suffisent a saturer un telephone. Au-dela, mieux vaut refuser franchement que
 * faire echouer l'ecriture plus tard.
 */
export const MAX_QUEUED_BYTES = 400 * 1024 * 1024

/** Echec definitif : le serveur a refuse le fichier, le reessayer ne sert a rien. */
export class UploadRejectedError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'UploadRejectedError'
    this.reason = reason
  }
}

export interface FlushReport {
  /** Identifiants envoyes avec succes, puis retires de la file. */
  readonly sent: readonly string[]
  /** Envois abandonnes parce que le serveur les a refuses. */
  readonly rejected: readonly { readonly id: string; readonly reason: string }[]
  /** Envois restant en attente, faute de reseau. */
  readonly pending: number
}

export type UploadSender = (item: QueuedUpload, file: File) => Promise<void>

export interface UploadQueueOptions {
  now?: () => number
  newId?: () => string
}

export class UploadQueue {
  readonly #storage: FileStorage
  readonly #now: () => number
  readonly #newId: () => string
  #manifest: QueueManifest | null = null
  /** Serialise les ecritures : deux `enqueue` concurrents se perdraient. */
  #chain: Promise<unknown> = Promise.resolve()

  constructor(storage: FileStorage, options: UploadQueueOptions = {}) {
    this.#storage = storage
    this.#now = options.now ?? Date.now
    this.#newId = options.newId ?? (() => crypto.randomUUID())
  }

  async list(): Promise<readonly QueuedUpload[]> {
    return (await this.#load()).items
  }

  async queuedBytes(): Promise<number> {
    return (await this.#load()).items.reduce((total, item) => total + item.bytes, 0)
  }

  /** Ajoute un fichier a la file et renvoie sa fiche. */
  enqueue(file: File): Promise<QueuedUpload> {
    return this.#serialize(async () => {
      const manifest = await this.#load()
      const used = manifest.items.reduce((total, item) => total + item.bytes, 0)
      const free = MAX_QUEUED_BYTES - used
      if (file.size > free) throw new QuotaExceededError(file.size, Math.max(free, 0))

      const item: QueuedUpload = {
        id: this.#newId(),
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
        queuedAt: this.#now(),
        attempts: 0,
      }

      await this.#storage.write(dataFileName(item.id), new Uint8Array(await file.arrayBuffer()))
      await this.#save({ ...manifest, items: [...manifest.items, item] })
      return item
    })
  }

  remove(id: string): Promise<void> {
    return this.#serialize(async () => {
      const manifest = await this.#load()
      await this.#storage.remove(dataFileName(id))
      await this.#save({ ...manifest, items: manifest.items.filter((item) => item.id !== id) })
    })
  }

  clear(): Promise<void> {
    return this.#serialize(async () => {
      const manifest = await this.#load()
      for (const item of manifest.items) await this.#storage.remove(dataFileName(item.id))
      await this.#save(EMPTY_QUEUE)
    })
  }

  /** Reconstruit le fichier tel qu'il a ete depose. */
  async read(id: string): Promise<File | null> {
    const manifest = await this.#load()
    const item = manifest.items.find((candidate) => candidate.id === id)
    if (!item) return null

    const data = await this.#storage.read(dataFileName(id))
    if (!data) return null

    return new File([data as BlobPart], item.filename, { type: item.contentType })
  }

  /**
   * Vide la file, du plus ancien au plus recent.
   *
   * Un refus du serveur retire l'envoi : le reessayer donnerait le meme refus.
   * Un echec reseau, lui, arrete la boucle — si un envoi ne passe pas, les
   * suivants ne passeront pas davantage, et chaque tentative coute de la batterie.
   */
  flush(send: UploadSender, options: { signal?: AbortSignal } = {}): Promise<FlushReport> {
    return this.#serialize(async () => {
      const sent: string[] = []
      const rejected: { id: string; reason: string }[] = []

      for (const item of (await this.#load()).items) {
        if (options.signal?.aborted) break

        const data = await this.#storage.read(dataFileName(item.id))
        if (!data) {
          // Fiche sans octets : un enregistrement interrompu. Rien a renvoyer.
          rejected.push({ id: item.id, reason: 'Fichier introuvable.' })
          continue
        }

        const file = new File([data as BlobPart], item.filename, { type: item.contentType })

        try {
          await send(item, file)
          sent.push(item.id)
        } catch (error) {
          if (error instanceof UploadRejectedError) {
            rejected.push({ id: item.id, reason: error.reason })
            continue
          }
          await this.#recordFailure(item.id, describe(error))
          break
        }
      }

      const done = new Set([...sent, ...rejected.map((entry) => entry.id)])
      if (done.size > 0) {
        for (const id of done) await this.#storage.remove(dataFileName(id))
        const manifest = await this.#load()
        await this.#save({
          ...manifest,
          items: manifest.items.filter((item) => !done.has(item.id)),
        })
      }

      return { sent, rejected, pending: (await this.#load()).items.length }
    })
  }

  async #recordFailure(id: string, reason: string): Promise<void> {
    const manifest = await this.#load()
    await this.#save({
      ...manifest,
      items: manifest.items.map((item) =>
        item.id === id ? { ...item, attempts: item.attempts + 1, lastError: reason } : item,
      ),
    })
  }

  async #load(): Promise<QueueManifest> {
    this.#manifest ??= parseQueue(await readText(this.#storage, QUEUE_FILE))
    return this.#manifest
  }

  async #save(manifest: QueueManifest): Promise<void> {
    this.#manifest = manifest
    await this.#storage.write(QUEUE_FILE, new TextEncoder().encode(JSON.stringify(manifest)))
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(task, task)
    // La chaine ne doit pas porter le rejet : un echec bloquerait tout le reste.
    this.#chain = next.catch(() => undefined)
    return next
  }
}

export function parseQueue(raw: string | null): QueueManifest {
  if (!raw) return EMPTY_QUEUE

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_QUEUE

    const items = (parsed as { items?: unknown }).items
    if (!Array.isArray(items)) return EMPTY_QUEUE

    return { version: 1, items: items.filter(isQueuedUpload) }
  } catch {
    // Manifeste illisible : repartir a vide vaut mieux que refuser tout envoi.
    return EMPTY_QUEUE
  }
}

export function dataFileName(id: string): string {
  return `upload-${id}.bin`
}

function isQueuedUpload(value: unknown): value is QueuedUpload {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.filename === 'string' &&
    typeof item.contentType === 'string' &&
    typeof item.bytes === 'number' &&
    typeof item.queuedAt === 'number' &&
    typeof item.attempts === 'number'
  )
}

async function readText(storage: FileStorage, name: string): Promise<string | null> {
  const data = await storage.read(name)
  return data ? new TextDecoder().decode(data) : null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Envoi impossible.'
}
