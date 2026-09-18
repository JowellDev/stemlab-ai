import { describe, expect, it } from 'vitest'
import { MemoryStorage, QuotaExceededError } from '../src/storage.js'
import {
  MAX_QUEUED_BYTES,
  QUEUE_FILE,
  UploadQueue,
  UploadRejectedError,
  dataFileName,
  parseQueue,
  type QueuedUpload,
} from '../src/upload-queue.js'

function makeQueue(storage = new MemoryStorage()) {
  let clock = 1_000
  let counter = 0
  const queue = new UploadQueue(storage, {
    now: () => (clock += 1_000),
    newId: () => `id-${++counter}`,
  })
  return { queue, storage }
}

function fileOf(name: string, content: string, type = 'audio/mpeg'): File {
  return new File([content], name, { type })
}

describe('parseQueue', () => {
  it('rend une file vide sur un manifeste absent ou illisible', () => {
    expect(parseQueue(null).items).toEqual([])
    expect(parseQueue('{{').items).toEqual([])
    expect(parseQueue('[]').items).toEqual([])
  })

  it('ecarte les fiches incompletes sans jeter les autres', () => {
    const valide: QueuedUpload = {
      id: 'a',
      filename: 'a.mp3',
      contentType: 'audio/mpeg',
      bytes: 3,
      queuedAt: 1,
      attempts: 0,
    }
    const parsed = parseQueue(JSON.stringify({ version: 1, items: [valide, { id: 'b' }] }))
    expect(parsed.items).toEqual([valide])
  })
})

describe('UploadQueue', () => {
  it('conserve le fichier et sa fiche', async () => {
    const { queue, storage } = makeQueue()

    const item = await queue.enqueue(fileOf('demo.mp3', 'abcde'))

    expect(item.filename).toBe('demo.mp3')
    expect(item.bytes).toBe(5)
    expect(item.attempts).toBe(0)
    expect(await storage.read(dataFileName(item.id))).not.toBeNull()

    const restored = await queue.read(item.id)
    expect(await restored?.text()).toBe('abcde')
    expect(restored?.type).toBe('audio/mpeg')
  })

  it('se relit depuis le stockage apres un rechargement', async () => {
    const { queue, storage } = makeQueue()
    await queue.enqueue(fileOf('demo.mp3', 'abcde'))

    const reouverte = new UploadQueue(storage)
    const items = await reouverte.list()

    expect(items).toHaveLength(1)
    expect(items[0]!.filename).toBe('demo.mp3')
    expect(await (await reouverte.read(items[0]!.id))?.text()).toBe('abcde')
  })

  it('refuse un fichier qui deborde le plafond de la file', async () => {
    const { queue } = makeQueue()
    const enorme = { name: 'gros.wav', type: 'audio/wav', size: MAX_QUEUED_BYTES + 1 } as File

    await expect(queue.enqueue(enorme)).rejects.toBeInstanceOf(QuotaExceededError)
    expect(await queue.list()).toEqual([])
  })

  it('envoie du plus ancien au plus recent puis vide la file', async () => {
    const { queue } = makeQueue()
    await queue.enqueue(fileOf('un.mp3', 'a'))
    await queue.enqueue(fileOf('deux.mp3', 'bb'))

    const envoyes: string[] = []
    const report = await queue.flush(async (item, file) => {
      envoyes.push(`${item.filename}:${await file.text()}`)
    })

    expect(envoyes).toEqual(['un.mp3:a', 'deux.mp3:bb'])
    expect(report.sent).toHaveLength(2)
    expect(report.pending).toBe(0)
    expect(await queue.list()).toEqual([])
  })

  it('retire un envoi refuse par le serveur et poursuit', async () => {
    const { queue } = makeQueue()
    await queue.enqueue(fileOf('mauvais.mp3', 'a'))
    await queue.enqueue(fileOf('bon.mp3', 'b'))

    const report = await queue.flush(async (item) => {
      if (item.filename === 'mauvais.mp3') throw new UploadRejectedError('Format refuse.')
    })

    expect(report.rejected).toEqual([{ id: 'id-1', reason: 'Format refuse.' }])
    expect(report.sent).toEqual(['id-2'])
    expect(await queue.list()).toEqual([])
  })

  it('garde les envois et s arrete au premier echec reseau', async () => {
    const { queue } = makeQueue()
    await queue.enqueue(fileOf('un.mp3', 'a'))
    await queue.enqueue(fileOf('deux.mp3', 'b'))

    let tentatives = 0
    const report = await queue.flush(async () => {
      tentatives += 1
      throw new Error('reseau indisponible')
    })

    // Le second n'est meme pas tente : il echouerait de la meme facon.
    expect(tentatives).toBe(1)
    expect(report.sent).toEqual([])
    expect(report.pending).toBe(2)

    const items = await queue.list()
    expect(items[0]!.attempts).toBe(1)
    expect(items[0]!.lastError).toBe('reseau indisponible')
  })

  it('reprend apres le retour du reseau', async () => {
    const { queue } = makeQueue()
    await queue.enqueue(fileOf('un.mp3', 'a'))

    await queue.flush(async () => {
      throw new Error('hors ligne')
    })
    const report = await queue.flush(async () => undefined)

    expect(report.sent).toHaveLength(1)
    expect(await queue.list()).toEqual([])
  })

  it('ecarte une fiche dont les octets ont disparu', async () => {
    const { queue, storage } = makeQueue()
    const item = await queue.enqueue(fileOf('perdu.mp3', 'a'))
    await storage.remove(dataFileName(item.id))

    const report = await queue.flush(async () => undefined)

    expect(report.rejected).toEqual([{ id: item.id, reason: 'Fichier introuvable.' }])
    expect(await queue.list()).toEqual([])
  })

  it('serialise les ajouts concurrents', async () => {
    const { queue } = makeQueue()

    await Promise.all([
      queue.enqueue(fileOf('un.mp3', 'a')),
      queue.enqueue(fileOf('deux.mp3', 'b')),
      queue.enqueue(fileOf('trois.mp3', 'c')),
    ])

    expect(await queue.list()).toHaveLength(3)
  })

  it('retire un envoi et ses octets', async () => {
    const { queue, storage } = makeQueue()
    const item = await queue.enqueue(fileOf('un.mp3', 'a'))

    await queue.remove(item.id)

    expect(await queue.list()).toEqual([])
    expect(await storage.read(dataFileName(item.id))).toBeNull()
    expect(await queue.queuedBytes()).toBe(0)
  })

  it('vide entierement la file', async () => {
    const { queue, storage } = makeQueue()
    await queue.enqueue(fileOf('un.mp3', 'a'))
    await queue.enqueue(fileOf('deux.mp3', 'b'))

    await queue.clear()

    expect(await queue.list()).toEqual([])
    expect((await storage.list()).filter((name) => name !== QUEUE_FILE)).toEqual([])
  })
})
