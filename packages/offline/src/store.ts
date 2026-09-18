import type { StemType } from '@stemlab/contracts'
import {
  EMPTY_MANIFEST,
  MANIFEST_FILE,
  type Manifest,
  type StoredTrack,
  parseManifest,
  selectForEviction,
  stemFileName,
  totalBytes,
} from './manifest.js'
import { type FileStorage, QuotaExceededError } from './storage.js'

/**
 * Stockage hors-ligne des morceaux.
 *
 * Deux garde-fous, parce qu'un utilisateur ne doit jamais se retrouver avec un
 * stockage sature par notre faute :
 *
 * - un **plafond** propre a l'application, independant du quota du navigateur ;
 * - une **eviction LRU** : quand il faut de la place, les morceaux les moins
 *   recemment ecoutes partent les premiers.
 *
 * Le morceau qu'on est en train d'enregistrer est toujours protege de l'eviction :
 * le liberer pour se faire de la place serait absurde.
 */

/** Plafond par defaut : deux gigaoctets, soit une trentaine de morceaux. */
export const DEFAULT_BUDGET_BYTES = 2 * 1024 * 1024 * 1024

/** Marge conservee sous le quota du navigateur. */
const SAFETY_MARGIN_BYTES = 50 * 1024 * 1024

export interface StemPayload {
  readonly type: StemType
  readonly format: string
  readonly data: Uint8Array
}

export interface SaveResult {
  readonly track: StoredTrack
  /** Morceaux liberes pour faire de la place. */
  readonly evicted: readonly StoredTrack[]
}

export interface OfflineStoreOptions {
  readonly budgetBytes?: number
  readonly now?: () => number
}

export class OfflineStore {
  readonly #storage: FileStorage
  readonly #budget: number
  readonly #now: () => number
  #manifest: Manifest | null = null

  constructor(storage: FileStorage, options: OfflineStoreOptions = {}) {
    this.#storage = storage
    this.#budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES
    this.#now = options.now ?? Date.now
  }

  async manifest(): Promise<Manifest> {
    if (this.#manifest) return this.#manifest
    const raw = await this.#storage.read(MANIFEST_FILE)
    this.#manifest = parseManifest(raw ? new TextDecoder().decode(raw) : null)
    return this.#manifest
  }

  async has(trackId: string): Promise<boolean> {
    return (await this.manifest()).tracks[trackId] !== undefined
  }

  async list(): Promise<StoredTrack[]> {
    const manifest = await this.manifest()
    return Object.values(manifest.tracks).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  }

  async usage(): Promise<{ used: number; budget: number; free: number | null }> {
    const manifest = await this.manifest()
    return {
      used: totalBytes(manifest),
      budget: this.#budget,
      free: await this.#storage.available(),
    }
  }

  /** Lit un stem stocke, ou `null` s'il ne l'est pas. */
  async readStem(trackId: string, type: StemType): Promise<Uint8Array | null> {
    const manifest = await this.manifest()
    const stem = manifest.tracks[trackId]?.stems.find((candidate) => candidate.type === type)
    if (!stem) return null
    return this.#storage.read(stem.file)
  }

  /**
   * Enregistre un morceau, en evincant si necessaire.
   *
   * L'ecriture des fichiers precede la mise a jour du manifeste : une coupure au
   * milieu laisse des fichiers orphelins — que `prune()` ramasse — plutot qu'un
   * manifeste decrivant des fichiers absents.
   */
  async save(
    track: { trackId: string; title: string },
    stems: readonly StemPayload[],
  ): Promise<SaveResult> {
    const bytes = stems.reduce((sum, stem) => sum + stem.data.byteLength, 0)
    const evicted = await this.#makeRoom(bytes, track.trackId)

    const written: StoredTrack['stems'][number][] = []
    for (const stem of stems) {
      const file = stemFileName(track.trackId, stem.type, stem.format)
      await this.#storage.write(file, stem.data)
      written.push({ type: stem.type, file, bytes: stem.data.byteLength })
    }

    const now = this.#now()
    const stored: StoredTrack = {
      trackId: track.trackId,
      title: track.title,
      stems: written,
      bytes,
      lastUsedAt: now,
      storedAt: now,
    }

    await this.#update((manifest) => ({
      ...manifest,
      tracks: { ...manifest.tracks, [track.trackId]: stored },
    }))

    return { track: stored, evicted }
  }

  /** Marque un morceau comme utilise : il repart au bout de la file d'eviction. */
  async touch(trackId: string): Promise<void> {
    const manifest = await this.manifest()
    const track = manifest.tracks[trackId]
    if (!track) return

    await this.#update((current) => ({
      ...current,
      tracks: {
        ...current.tracks,
        [trackId]: { ...track, lastUsedAt: this.#now() },
      },
    }))
  }

  async remove(trackId: string): Promise<void> {
    const manifest = await this.manifest()
    const track = manifest.tracks[trackId]
    if (!track) return

    for (const stem of track.stems) {
      await this.#storage.remove(stem.file)
    }

    await this.#update((current) => {
      const tracks = { ...current.tracks }
      delete tracks[trackId]
      return { ...current, tracks }
    })
  }

  async clear(): Promise<void> {
    for (const name of await this.#storage.list()) {
      if (name !== MANIFEST_FILE) await this.#storage.remove(name)
    }
    await this.#update(() => EMPTY_MANIFEST)
  }

  /**
   * Supprime les fichiers qu'aucun morceau ne reference.
   *
   * Ils apparaissent apres une coupure en cours d'enregistrement. Les laisser
   * consommerait du quota sans jamais servir.
   */
  async prune(): Promise<string[]> {
    const manifest = await this.manifest()
    const referenced = new Set(
      Object.values(manifest.tracks).flatMap((track) => track.stems.map((stem) => stem.file)),
    )

    const orphans = (await this.#storage.list()).filter(
      (name) => name !== MANIFEST_FILE && !referenced.has(name),
    )
    for (const name of orphans) await this.#storage.remove(name)
    return orphans
  }

  /** Libere la place necessaire, et renvoie ce qui a ete evince. */
  async #makeRoom(needed: number, protectedId: string): Promise<StoredTrack[]> {
    const manifest = await this.manifest()
    const used = totalBytes(manifest)

    // Reenregistrer un morceau remplace ses fichiers : seule la difference de
    // taille est a trouver, pas la totalite. Compter la taille pleine ferait
    // echouer un remplacement qui tient pourtant dans le plafond.
    const replaced = manifest.tracks[protectedId]?.bytes ?? 0
    const delta = needed - replaced

    const free = await this.#storage.available()
    const overBudget = used + delta - this.#budget
    const overQuota = free === null ? -1 : delta + SAFETY_MARGIN_BYTES - free

    const toFree = Math.max(overBudget, overQuota)
    if (toFree <= 0) return []

    const victims = selectForEviction(manifest, toFree, [protectedId])
    for (const victim of victims) await this.remove(victim.trackId)

    const freed = victims.reduce((sum, victim) => sum + victim.bytes, 0)
    if (freed < toFree) {
      throw new QuotaExceededError(delta, Math.max(0, freed + replaced))
    }

    return victims
  }

  async #update(change: (manifest: Manifest) => Manifest): Promise<void> {
    const next = change(await this.manifest())
    this.#manifest = next
    await this.#storage.write(
      MANIFEST_FILE,
      new TextEncoder().encode(JSON.stringify(next)),
    )
  }
}
