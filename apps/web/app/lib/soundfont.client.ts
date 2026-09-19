import type { SoundFontSynthesizer } from '@stemlab/audio-engine'
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import { OpfsStorage } from '@stemlab/offline'

/**
 * Chargement de la banque d'echantillons.
 *
 * Vingt-quatre megaoctets : c'est trop pour le precache du service worker, qui
 * doit rester leger pour que l'installation soit rapide. La banque est donc
 * recuperee a la demande — seulement si l'on choisit une voix echantillonnee —
 * puis conservee dans le stockage local. Les visites suivantes ne telechargent
 * rien, y compris hors connexion.
 *
 * Le pad synthetise reste le mode par defaut : il n'a besoin de rien.
 */

/** Adresse servie par l'application. Voir `scripts/fetch-soundfont.mjs`. */
export const DEFAULT_BANK_URL = '/soundfonts/FluidR3Mono_GM.sf3'

/**
 * Espace de stockage propre a la banque.
 *
 * Distinct de celui des morceaux telecharges : la banque ne doit ni compter
 * dans leur budget, ni disparaitre quand l'eviction fait de la place. Ce sont
 * deux choses que l'utilisateur gere separement.
 */
const NAMESPACE = 'stemlab-soundfonts'
const CACHE_KEY = 'FluidR3Mono_GM.sf3'

/** En deca, ce n'est pas la banque : page d'erreur, ou telechargement tronque. */
const MIN_BYTES = 20 * 1024 * 1024

export interface BankProgress {
  readonly loaded: number
  /** `null` quand le serveur n'annonce pas la taille. */
  readonly total: number | null
}

export interface LoadBankOptions {
  readonly url?: string
  readonly onProgress?: (progress: BankProgress) => void
  readonly signal?: AbortSignal
}

/**
 * Rend les octets de la banque, depuis le cache local si elle y est deja.
 *
 * Le cache est celui des morceaux hors-ligne : meme stockage, meme budget. Une
 * banque absente du cache est telechargee puis rangee — mais un echec
 * d'ecriture n'empeche pas de l'utiliser, il coute seulement un
 * retelechargement la prochaine fois.
 */
export async function loadBank(options: LoadBankOptions = {}): Promise<ArrayBuffer> {
  const storage = await openStorage()

  if (storage) {
    const cached = await storage.read(CACHE_KEY).catch(() => null)
    if (cached && cached.byteLength >= MIN_BYTES) {
      options.onProgress?.({ loaded: cached.byteLength, total: cached.byteLength })
      return toArrayBuffer(cached)
    }
  }

  const bytes = await download(options.url ?? DEFAULT_BANK_URL, options)

  if (storage) {
    await storage.write(CACHE_KEY, bytes).catch(() => {
      // Stockage plein ou indisponible : la banque reste utilisable, elle sera
      // simplement retelechargee la prochaine fois.
    })
  }

  return toArrayBuffer(bytes)
}

/** Supprime la banque du stockage local. */
export async function forgetBank(): Promise<void> {
  const storage = await openStorage()
  await storage?.remove(CACHE_KEY)
}

/** Vrai quand la banque est deja sur l'appareil : le chargement sera instantane. */
export async function isBankCached(): Promise<boolean> {
  const storage = await openStorage()
  if (!storage) return false
  const cached = await storage.read(CACHE_KEY).catch(() => null)
  return (cached?.byteLength ?? 0) >= MIN_BYTES
}

async function openStorage(): Promise<OpfsStorage | null> {
  if (!OpfsStorage.isSupported()) return null
  try {
    return await OpfsStorage.open(NAMESPACE)
  } catch {
    // Navigateur sans OPFS, ou stockage refuse : on se passe de cache.
    return null
  }
}

async function download(url: string, options: LoadBankOptions): Promise<Uint8Array> {
  const init: RequestInit = options.signal ? { signal: options.signal } : {}
  const response = await fetch(url, init)

  if (!response.ok) {
    throw new Error(`La banque d'echantillons est introuvable (HTTP ${response.status}).`)
  }

  const declared = Number(response.headers.get('content-length'))
  const total = Number.isFinite(declared) && declared > 0 ? declared : null

  // Lecture par morceaux pour rendre compte de l'avancement : sur un reseau
  // lent, vingt-quatre megaoctets sans retour donnent l'impression d'un blocage.
  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    options.onProgress?.({ loaded, total })
  }

  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  if (bytes.byteLength < MIN_BYTES) {
    throw new Error("Le fichier recu n'est pas une banque d'echantillons valide.")
  }

  return bytes
}

/**
 * Cree le synthetiseur et lui confie la banque.
 *
 * Le processeur tourne dans un AudioWorklet, donc sur son propre fil : une
 * interface occupee ne fait pas hoqueter le son.
 */
export async function createSynthesizer(
  context: AudioContext,
  bank: ArrayBuffer,
): Promise<SoundFontSynthesizer> {
  const { WorkletSynthesizer } = await import('spessasynth_lib')

  await context.audioWorklet.addModule(processorUrl)
  const synth = new WorkletSynthesizer(context) as unknown as SoundFontSynthesizer

  await synth.soundBankManager.addSoundBank(bank, 'main')
  await synth.isReady

  return synth
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // `addSoundBank` s'approprie le tampon : on lui en donne un a lui, sinon une
  // seconde lecture du cache trouverait un tampon detache.
  return bytes.slice().buffer as ArrayBuffer
}
