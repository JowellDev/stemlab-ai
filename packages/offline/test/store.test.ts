import type { StemType } from '@stemlab/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { MANIFEST_FILE } from '../src/manifest.js'
import { MemoryStorage, QuotaExceededError } from '../src/storage.js'
import { OfflineStore, type StemPayload } from '../src/store.js'

const STEM_TYPES: StemType[] = ['vocals', 'drums', 'bass', 'other']

function stems(bytesEach: number): StemPayload[] {
  return STEM_TYPES.map((type) => ({
    type,
    format: 'opus',
    data: new Uint8Array(bytesEach).fill(1),
  }))
}

/** Horloge pilotee : l'eviction depend de l'ordre d'usage, pas du temps reel. */
function clock(start = 1_000) {
  let value = start
  return {
    now: () => value,
    advance: (by: number) => {
      value += by
    },
  }
}

describe('OfflineStore — enregistrement', () => {
  let storage: MemoryStorage
  let store: OfflineStore

  beforeEach(() => {
    storage = new MemoryStorage()
    store = new OfflineStore(storage)
  })

  it('part d un stockage vide', async () => {
    expect(await store.list()).toEqual([])
    expect(await store.has('abc')).toBe(false)
    expect((await store.usage()).used).toBe(0)
  })

  it('enregistre un morceau et ses stems', async () => {
    const { track } = await store.save({ trackId: 'abc', title: 'Mon morceau' }, stems(100))

    expect(track.bytes).toBe(400)
    expect(track.stems).toHaveLength(4)
    expect(await store.has('abc')).toBe(true)
    expect((await store.usage()).used).toBe(400)
  })

  it('ecrit un fichier par stem', async () => {
    await store.save({ trackId: 'abc', title: 'x' }, stems(100))
    const files = await storage.list()

    expect(files).toContain('tracks/abc/vocals.opus')
    expect(files).toContain('tracks/abc/other.opus')
    expect(files).toContain(MANIFEST_FILE)
  })

  it('relit un stem enregistre', async () => {
    await store.save({ trackId: 'abc', title: 'x' }, stems(64))
    const data = await store.readStem('abc', 'drums')

    expect(data).not.toBeNull()
    expect(data?.byteLength).toBe(64)
  })

  it('rend null pour un stem absent', async () => {
    await store.save({ trackId: 'abc', title: 'x' }, stems(10))
    expect(await store.readStem('abc', 'piano')).toBeNull()
    expect(await store.readStem('inconnu', 'vocals')).toBeNull()
  })

  it('remplace un morceau deja stocke', async () => {
    await store.save({ trackId: 'abc', title: 'v1' }, stems(100))
    await store.save({ trackId: 'abc', title: 'v2' }, stems(50))

    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('v2')
    expect((await store.usage()).used).toBe(200)
  })

  it('survit a un redemarrage', async () => {
    await store.save({ trackId: 'abc', title: 'Mon morceau' }, stems(100))

    // Nouveau magasin sur le meme stockage : le manifeste doit se relire.
    const reopened = new OfflineStore(storage)
    expect(await reopened.has('abc')).toBe(true)
    expect((await reopened.list())[0]?.title).toBe('Mon morceau')
  })
})

describe('OfflineStore — suppression', () => {
  it('supprime les fichiers et l entree', async () => {
    const storage = new MemoryStorage()
    const store = new OfflineStore(storage)

    await store.save({ trackId: 'abc', title: 'x' }, stems(100))
    await store.remove('abc')

    expect(await store.has('abc')).toBe(false)
    expect((await storage.list()).filter((name) => name !== MANIFEST_FILE)).toEqual([])
  })

  it('ignore un morceau inconnu', async () => {
    const store = new OfflineStore(new MemoryStorage())
    await expect(store.remove('inconnu')).resolves.toBeUndefined()
  })

  it('vide tout le stockage', async () => {
    const storage = new MemoryStorage()
    const store = new OfflineStore(storage)

    await store.save({ trackId: 'a', title: 'a' }, stems(100))
    await store.save({ trackId: 'b', title: 'b' }, stems(100))
    await store.clear()

    expect(await store.list()).toEqual([])
    expect((await store.usage()).used).toBe(0)
  })
})

describe('OfflineStore — eviction', () => {
  it('evince le moins recemment utilise quand le plafond est atteint', async () => {
    const time = clock()
    const store = new OfflineStore(new MemoryStorage(), {
      budgetBytes: 1000,
      now: time.now,
    })

    await store.save({ trackId: 'a', title: 'a' }, stems(100)) // 400 o
    time.advance(10)
    await store.save({ trackId: 'b', title: 'b' }, stems(100)) // 800 o
    time.advance(10)

    const { evicted } = await store.save({ trackId: 'c', title: 'c' }, stems(100))

    expect(evicted.map((track) => track.trackId)).toEqual(['a'])
    expect(await store.has('a')).toBe(false)
    expect(await store.has('b')).toBe(true)
    expect(await store.has('c')).toBe(true)
  })

  it('tient compte de l ordre d ecoute, pas de l ordre d enregistrement', async () => {
    const time = clock()
    const store = new OfflineStore(new MemoryStorage(), { budgetBytes: 1000, now: time.now })

    await store.save({ trackId: 'a', title: 'a' }, stems(100))
    time.advance(10)
    await store.save({ trackId: 'b', title: 'b' }, stems(100))
    time.advance(10)

    // « a » est reecoute : il ne doit plus etre le premier candidat.
    await store.touch('a')
    time.advance(10)

    const { evicted } = await store.save({ trackId: 'c', title: 'c' }, stems(100))
    expect(evicted.map((track) => track.trackId)).toEqual(['b'])
  })

  it('ne s evince jamais lui-meme', async () => {
    const store = new OfflineStore(new MemoryStorage(), { budgetBytes: 500 })
    await store.save({ trackId: 'a', title: 'a' }, stems(100))

    // Reenregistrer « a » ne doit pas le supprimer pour se faire de la place.
    const { evicted } = await store.save({ trackId: 'a', title: 'a' }, stems(120))
    expect(evicted).toEqual([])
    expect(await store.has('a')).toBe(true)
  })

  it('echoue clairement quand meme tout evincer ne suffit pas', async () => {
    const store = new OfflineStore(new MemoryStorage(), { budgetBytes: 500 })
    await expect(store.save({ trackId: 'gros', title: 'gros' }, stems(1000))).rejects.toThrow(
      QuotaExceededError,
    )
  })

  it('tient compte du quota du navigateur, pas seulement du plafond', async () => {
    const time = clock()
    // Plafond genereux, mais navigateur presque plein : c'est lui qui contraint.
    const store = new OfflineStore(new MemoryStorage(120 * 1024 * 1024), {
      budgetBytes: 10 * 1024 * 1024 * 1024,
      now: time.now,
    })

    await store.save({ trackId: 'a', title: 'a' }, stems(10 * 1024 * 1024))
    time.advance(10)
    const { evicted } = await store.save({ trackId: 'b', title: 'b' }, stems(10 * 1024 * 1024))

    expect(evicted.map((track) => track.trackId)).toEqual(['a'])
  })

  it('n evince pas quand la place suffit', async () => {
    const store = new OfflineStore(new MemoryStorage(), { budgetBytes: 10_000 })
    await store.save({ trackId: 'a', title: 'a' }, stems(100))
    const { evicted } = await store.save({ trackId: 'b', title: 'b' }, stems(100))
    expect(evicted).toEqual([])
  })
})

describe('OfflineStore — fichiers orphelins', () => {
  it('ramasse les fichiers qu aucun morceau ne reference', async () => {
    const storage = new MemoryStorage()
    const store = new OfflineStore(storage)

    await store.save({ trackId: 'a', title: 'a' }, stems(100))
    // Simule une coupure en cours d'enregistrement : le fichier existe, le
    // manifeste ne le connait pas.
    await storage.write('tracks/orphelin/vocals.opus', new Uint8Array(50))

    expect(await store.prune()).toEqual(['tracks/orphelin/vocals.opus'])
    expect(await storage.read('tracks/orphelin/vocals.opus')).toBeNull()
    // Les fichiers legitimes sont conserves.
    expect(await storage.read('tracks/a/vocals.opus')).not.toBeNull()
  })

  it('ne touche pas au manifeste', async () => {
    const storage = new MemoryStorage()
    const store = new OfflineStore(storage)
    await store.save({ trackId: 'a', title: 'a' }, stems(10))

    await store.prune()
    expect(await storage.read(MANIFEST_FILE)).not.toBeNull()
  })
})
