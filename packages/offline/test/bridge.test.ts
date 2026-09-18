import { describe, expect, it, vi } from 'vitest'
import {
  OFFLINE_SCHEME,
  OfflineDownloadError,
  createOfflineFetch,
  downloadTrack,
  offlineUrl,
  parseOfflineUrl,
} from '../src/bridge.js'
import { MemoryStorage } from '../src/storage.js'
import { OfflineStore } from '../src/store.js'

describe('offlineUrl', () => {
  it('construit une URL relisible', () => {
    const url = offlineUrl('abc', 'vocals')
    expect(url.startsWith(OFFLINE_SCHEME)).toBe(true)
    expect(parseOfflineUrl(url)).toEqual({ trackId: 'abc', type: 'vocals' })
  })

  it.each(['https://exemple.fr/a.opus', '', 'stemlab-offline://', 'stemlab-offline://abc'])(
    'rend null pour %s',
    (url) => {
      expect(parseOfflineUrl(url)).toBeNull()
    },
  )
})

describe('createOfflineFetch', () => {
  async function storeWith(bytes = 128) {
    const store = new OfflineStore(new MemoryStorage())
    await store.save({ trackId: 'abc', title: 'x' }, [
      { type: 'vocals', format: 'opus', data: new Uint8Array(bytes).fill(7) },
    ])
    return store
  }

  it('sert une piste stockee', async () => {
    const offlineFetch = createOfflineFetch(await storeWith())
    const response = await offlineFetch(offlineUrl('abc', 'vocals'))

    expect(response.ok).toBe(true)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect((await response.arrayBuffer()).byteLength).toBe(128)
  })

  it('rend une 404 pour une piste absente', async () => {
    // Un morceau evince entre l'affichage et la lecture : le lecteur doit
    // signaler l'echec comme pour n'importe quelle piste.
    const offlineFetch = createOfflineFetch(await storeWith())
    const response = await offlineFetch(offlineUrl('inconnu', 'vocals'))
    expect(response.status).toBe(404)
  })

  it('delegue les autres URL', async () => {
    const fallback = vi.fn(async () => new Response('distant'))
    const offlineFetch = createOfflineFetch(await storeWith(), fallback as unknown as typeof fetch)

    const response = await offlineFetch('https://exemple.fr/vocals.opus')
    expect(await response.text()).toBe('distant')
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('marque le morceau comme utilise', async () => {
    const store = await storeWith()
    const touch = vi.spyOn(store, 'touch')

    await createOfflineFetch(store)(offlineUrl('abc', 'vocals'))
    // C'est ce qui repousse le morceau au bout de la file d'eviction.
    expect(touch).toHaveBeenCalledWith('abc')
  })
})

describe('downloadTrack', () => {
  const stems = [
    { type: 'vocals' as const, url: 'https://exemple.fr/vocals.opus', format: 'opus' },
    { type: 'drums' as const, url: 'https://exemple.fr/drums.opus', format: 'opus' },
  ]

  function fetchReturning(size = 64) {
    return vi.fn(async () => new Response(new Uint8Array(size))) as unknown as typeof fetch
  }

  it('enregistre chaque stem', async () => {
    const store = new OfflineStore(new MemoryStorage())
    await downloadTrack(store, { trackId: 'abc', title: 'x' }, stems, {
      fetchImpl: fetchReturning(),
    })

    expect(await store.has('abc')).toBe(true)
    expect((await store.readStem('abc', 'drums'))?.byteLength).toBe(64)
  })

  it('remonte la progression, une piste apres l autre', async () => {
    const seen: Array<{ loaded: number; total: number }> = []
    await downloadTrack(
      new OfflineStore(new MemoryStorage()),
      { trackId: 'abc', title: 'x' },
      stems,
      { fetchImpl: fetchReturning(), onProgress: (p) => seen.push({ loaded: p.loaded, total: p.total }) },
    )

    expect(seen).toEqual([
      { loaded: 1, total: 2 },
      { loaded: 2, total: 2 },
    ])
  })

  it('signale une piste indisponible', async () => {
    const failing = vi.fn(async () => new Response(null, { status: 403 }))
    await expect(
      downloadTrack(new OfflineStore(new MemoryStorage()), { trackId: 'abc', title: 'x' }, stems, {
        fetchImpl: failing as unknown as typeof fetch,
      }),
    ).rejects.toThrow(OfflineDownloadError)
  })

  it('n enregistre rien quand une piste echoue', async () => {
    // Un morceau a moitie stocke serait injouable : mieux vaut ne rien garder.
    const store = new OfflineStore(new MemoryStorage())
    let call = 0
    const flaky = vi.fn(async () => {
      call += 1
      return call === 1 ? new Response(new Uint8Array(32)) : new Response(null, { status: 500 })
    })

    await expect(
      downloadTrack(store, { trackId: 'abc', title: 'x' }, stems, {
        fetchImpl: flaky as unknown as typeof fetch,
      }),
    ).rejects.toThrow(OfflineDownloadError)

    expect(await store.has('abc')).toBe(false)
  })

  it('signale une erreur reseau', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      downloadTrack(new OfflineStore(new MemoryStorage()), { trackId: 'abc', title: 'x' }, stems, {
        fetchImpl: offline as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/impossible/)
  })
})
