import { describe, expect, it } from 'vitest'
import {
  EMPTY_MANIFEST,
  type Manifest,
  type StoredTrack,
  parseManifest,
  selectForEviction,
  stemFileName,
  totalBytes,
} from '../src/manifest.js'

function track(id: string, bytes: number, lastUsedAt: number): StoredTrack {
  return {
    trackId: id,
    title: id,
    stems: [{ type: 'vocals', file: `tracks/${id}/vocals.opus`, bytes }],
    bytes,
    lastUsedAt,
    storedAt: 0,
  }
}

function manifest(...tracks: StoredTrack[]): Manifest {
  return {
    version: 1,
    tracks: Object.fromEntries(tracks.map((entry) => [entry.trackId, entry])),
  }
}

describe('parseManifest', () => {
  it('rend un manifeste vide sans contenu', () => {
    expect(parseManifest(null)).toEqual(EMPTY_MANIFEST)
    expect(parseManifest('')).toEqual(EMPTY_MANIFEST)
  })

  it('relit ce qu il a ecrit', () => {
    const source = manifest(track('a', 100, 1))
    expect(parseManifest(JSON.stringify(source))).toEqual(source)
  })

  it.each(['pas du json', '{"version":2}', '[]', 'null', '{"version":1}'])(
    'retombe sur un manifeste vide pour %s',
    (raw) => {
      // Un manifeste illisible vaut un stockage vide : mieux vaut retelecharger
      // que servir des references qu'on ne sait plus decrire.
      expect(parseManifest(raw)).toEqual(EMPTY_MANIFEST)
    },
  )
})

describe('totalBytes', () => {
  it('additionne la taille des morceaux', () => {
    expect(totalBytes(manifest(track('a', 100, 1), track('b', 250, 2)))).toBe(350)
  })

  it('rend zero pour un manifeste vide', () => {
    expect(totalBytes(EMPTY_MANIFEST)).toBe(0)
  })
})

describe('selectForEviction', () => {
  const full = manifest(track('ancien', 100, 1), track('moyen', 100, 5), track('recent', 100, 9))

  it('ne retient rien quand il n y a rien a liberer', () => {
    expect(selectForEviction(full, 0)).toEqual([])
    expect(selectForEviction(full, -10)).toEqual([])
  })

  it('evince le moins recemment utilise en premier', () => {
    expect(selectForEviction(full, 50).map((t) => t.trackId)).toEqual(['ancien'])
  })

  it('evince autant que necessaire', () => {
    expect(selectForEviction(full, 150).map((t) => t.trackId)).toEqual(['ancien', 'moyen'])
  })

  it('protege les morceaux demandes', () => {
    // Liberer le morceau qu'on est en train d'enregistrer serait absurde.
    expect(selectForEviction(full, 50, ['ancien']).map((t) => t.trackId)).toEqual(['moyen'])
  })

  it('ne rend que ce qu il peut quand la demande depasse le stock', () => {
    expect(selectForEviction(full, 10_000)).toHaveLength(3)
  })

  it('rend une liste vide sur un manifeste vide', () => {
    expect(selectForEviction(EMPTY_MANIFEST, 100)).toEqual([])
  })
})

describe('stemFileName', () => {
  it('range les stems par morceau', () => {
    expect(stemFileName('abc', 'vocals', 'opus')).toBe('tracks/abc/vocals.opus')
  })
})
