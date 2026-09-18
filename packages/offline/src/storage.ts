/**
 * Abstraction du stockage de fichiers.
 *
 * L'implementation reelle est l'OPFS, qui n'existe que dans un navigateur. En
 * passer par une interface etroite permet de tester la logique qui compte —
 * l'eviction, les quotas, la coherence du manifeste — sans navigateur, et sans
 * simuler une API dont on ne maitrise pas le comportement.
 */
export interface FileStorage {
  read(name: string): Promise<Uint8Array | null>
  write(name: string, data: Uint8Array): Promise<void>
  remove(name: string): Promise<void>
  list(): Promise<string[]>
  /** Octets disponibles, ou `null` quand le navigateur ne sait pas l'estimer. */
  available(): Promise<number | null>
}

/** Implementation en memoire, pour les tests. */
export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Uint8Array>()
  #available: number | null

  constructor(available: number | null = null) {
    this.#available = available
  }

  async read(name: string): Promise<Uint8Array | null> {
    return this.files.get(name) ?? null
  }

  async write(name: string, data: Uint8Array): Promise<void> {
    if (this.#available !== null) {
      const previous = this.files.get(name)?.byteLength ?? 0
      if (data.byteLength - previous > this.#available) {
        throw new QuotaExceededError(data.byteLength, this.#available)
      }
      this.#available -= data.byteLength - previous
    }
    this.files.set(name, data)
  }

  async remove(name: string): Promise<void> {
    const removed = this.files.get(name)
    if (removed && this.#available !== null) this.#available += removed.byteLength
    this.files.delete(name)
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()]
  }

  async available(): Promise<number | null> {
    return this.#available
  }
}

export class QuotaExceededError extends Error {
  readonly needed: number
  readonly free: number

  constructor(needed: number, free: number) {
    super(`espace insuffisant : ${needed} octets demandes, ${free} disponibles`)
    this.name = 'QuotaExceededError'
    this.needed = needed
    this.free = free
  }
}
