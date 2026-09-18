import { type FileStorage, QuotaExceededError } from './storage.js'

/**
 * Stockage sur l'OPFS (Origin Private File System).
 *
 * Choisi plutot qu'IndexedDB : les fichiers y sont de vrais fichiers, lisibles en
 * flux et sans serialisation, et le navigateur leur applique le meme quota que le
 * reste de l'origine. Un stem de trois megaoctets n'a rien a faire dans une base
 * cle-valeur.
 *
 * Les noms comportent des `/` : chaque segment devient un repertoire, ce qui
 * permet de supprimer un morceau entier d'un seul appel.
 */
export class OpfsStorage implements FileStorage {
  readonly #root: FileSystemDirectoryHandle

  private constructor(root: FileSystemDirectoryHandle) {
    this.#root = root
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function' &&
      typeof FileSystemDirectoryHandle !== 'undefined'
    )
  }

  static async open(namespace = 'stemlab'): Promise<OpfsStorage> {
    if (!OpfsStorage.isSupported()) {
      throw new Error("l'OPFS n'est pas disponible dans ce navigateur")
    }
    const root = await navigator.storage.getDirectory()
    return new OpfsStorage(await root.getDirectoryHandle(namespace, { create: true }))
  }

  async read(name: string): Promise<Uint8Array | null> {
    const located = await this.#locate(name, false)
    if (!located) return null

    try {
      const handle = await located.directory.getFileHandle(located.file)
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      // `NotFoundError` : le fichier n'existe pas. Toute autre defaillance de
      // lecture se traite pareil — il faudra retelecharger.
      return null
    }
  }

  async write(name: string, data: Uint8Array): Promise<void> {
    const located = await this.#locate(name, true)
    if (!located) throw new Error(`chemin invalide : ${name}`)

    try {
      const handle = await located.directory.getFileHandle(located.file, { create: true })
      const writable = await handle.createWritable()
      // Un `Uint8Array` peut s'appuyer sur un `SharedArrayBuffer`, que l'API
      // d'ecriture refuse : on lui passe une vue sur un tampon ordinaire.
      await writable.write(new Uint8Array(data).buffer as ArrayBuffer)
      await writable.close()
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        throw new QuotaExceededError(data.byteLength, 0)
      }
      throw cause
    }
  }

  async remove(name: string): Promise<void> {
    const located = await this.#locate(name, false)
    if (!located) return

    try {
      await located.directory.removeEntry(located.file)
    } catch {
      // Deja absent : c'est le resultat attendu.
    }
  }

  async list(): Promise<string[]> {
    return collect(this.#root, '')
  }

  async available(): Promise<number | null> {
    if (typeof navigator.storage?.estimate !== 'function') return null
    const { quota, usage } = await navigator.storage.estimate()
    if (quota === undefined) return null
    return Math.max(0, quota - (usage ?? 0))
  }

  /** Remonte l'arborescence jusqu'au repertoire parent du fichier. */
  async #locate(
    name: string,
    create: boolean,
  ): Promise<{ directory: FileSystemDirectoryHandle; file: string } | null> {
    const segments = name.split('/').filter(Boolean)
    const file = segments.pop()
    if (!file) return null

    let directory = this.#root
    for (const segment of segments) {
      try {
        directory = await directory.getDirectoryHandle(segment, { create })
      } catch {
        return null
      }
    }

    return { directory, file }
  }
}

async function collect(directory: FileSystemDirectoryHandle, prefix: string): Promise<string[]> {
  const names: string[] = []

  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      names.push(...(await collect(handle, path)))
    } else {
      names.push(path)
    }
  }

  return names
}
