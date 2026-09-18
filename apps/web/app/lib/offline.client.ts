import { OfflineStore, OpfsStorage, UploadQueue, createOfflineFetch } from '@stemlab/offline'

/**
 * Magasin hors-ligne de l'application.
 *
 * Une seule instance par onglet : le manifeste est tenu en memoire, et deux
 * magasins concurrents finiraient par se contredire.
 *
 * L'ouverture est paresseuse et memorisee, y compris en cas d'echec — sur un
 * navigateur sans OPFS, on ne veut pas retenter a chaque appel.
 */
let pending: Promise<OfflineStore | null> | null = null

export function isOfflineSupported(): boolean {
  return OpfsStorage.isSupported()
}

export function getOfflineStore(): Promise<OfflineStore | null> {
  pending ??= open()
  return pending
}

async function open(): Promise<OfflineStore | null> {
  if (!OpfsStorage.isSupported()) return null

  try {
    const storage = await OpfsStorage.open()
    const store = new OfflineStore(storage)
    // Ramasse les fichiers laisses par un enregistrement interrompu.
    void store.prune()
    return store
  } catch (error) {
    console.warn('stockage hors-ligne indisponible', error)
    return null
  }
}

/**
 * File d'envoi differee, adossee au meme stockage que les morceaux.
 *
 * Elle s'ouvre independamment du magasin : une file utilisable ne suppose pas
 * qu'un seul morceau ait ete telecharge.
 */
let pendingQueue: Promise<UploadQueue | null> | null = null

export function getUploadQueue(): Promise<UploadQueue | null> {
  pendingQueue ??= openQueue()
  return pendingQueue
}

async function openQueue(): Promise<UploadQueue | null> {
  if (!OpfsStorage.isSupported()) return null

  try {
    return new UploadQueue(await OpfsStorage.open())
  } catch (error) {
    console.warn('file d envoi indisponible', error)
    return null
  }
}

/**
 * `fetch` qui resout les URL hors-ligne, en ouvrant le magasin a la demande.
 *
 * L'ouverture du stockage est asynchrone, alors que le lecteur attend un `fetch`
 * synchrone a la construction : cette enveloppe leve la contrainte.
 */
export function createLazyOfflineFetch(): typeof fetch {
  return async function lazyOfflineFetch(input, init) {
    const store = await getOfflineStore()
    if (!store) return fetch(input, init)
    return createOfflineFetch(store)(input, init)
  }
}
