import type { StemType } from '@stemlab/contracts'

/**
 * Manifeste des morceaux stockes.
 *
 * Il est ecrit dans le stockage lui-meme plutot que dans IndexedDB : une seule
 * source de verite, qui disparait avec les fichiers si l'utilisateur vide le
 * stockage du site. Un manifeste survivant a ses fichiers decrirait des morceaux
 * injouables.
 */

export interface StoredStem {
  readonly type: StemType
  readonly file: string
  readonly bytes: number
}

export interface StoredTrack {
  readonly trackId: string
  readonly title: string
  readonly stems: readonly StoredStem[]
  readonly bytes: number
  /** Epoch en millisecondes. Sert a l'eviction : le moins recemment lu part d'abord. */
  readonly lastUsedAt: number
  readonly storedAt: number
}

export interface Manifest {
  readonly version: 1
  readonly tracks: Record<string, StoredTrack>
}

export const EMPTY_MANIFEST: Manifest = { version: 1, tracks: {} }

export const MANIFEST_FILE = 'manifest.json'

export function parseManifest(raw: string | null): Manifest {
  if (!raw) return EMPTY_MANIFEST

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1
    ) {
      return EMPTY_MANIFEST
    }

    const tracks = (parsed as { tracks?: unknown }).tracks
    if (typeof tracks !== 'object' || tracks === null) return EMPTY_MANIFEST

    return { version: 1, tracks: tracks as Record<string, StoredTrack> }
  } catch {
    // Un manifeste illisible vaut un stockage vide : mieux vaut retelecharger que
    // de servir des references vers des fichiers qu'on ne sait plus decrire.
    return EMPTY_MANIFEST
  }
}

export function totalBytes(manifest: Manifest): number {
  return Object.values(manifest.tracks).reduce((sum, track) => sum + track.bytes, 0)
}

/**
 * Morceaux a evincer pour liberer `needed` octets.
 *
 * Les moins recemment utilises partent d'abord, en excluant ceux que l'appelant
 * protege — typiquement le morceau en cours de lecture.
 */
export function selectForEviction(
  manifest: Manifest,
  needed: number,
  protectedIds: readonly string[] = [],
): StoredTrack[] {
  if (needed <= 0) return []

  const candidates = Object.values(manifest.tracks)
    .filter((track) => !protectedIds.includes(track.trackId))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

  const evicted: StoredTrack[] = []
  let freed = 0

  for (const track of candidates) {
    if (freed >= needed) break
    evicted.push(track)
    freed += track.bytes
  }

  return evicted
}

export function stemFileName(trackId: string, type: StemType, format: string): string {
  return `tracks/${trackId}/${type}.${format}`
}
