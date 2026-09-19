import { OpfsStorage } from '@stemlab/offline'
import { keyId, parseKeyFromName } from '@stemlab/music'

/**
 * Bibliotheque de nappes personnelle.
 *
 * Les fichiers restent sur l'appareil, dans un espace de stockage qui leur est
 * propre. Ils ne transitent jamais par le serveur : ce sont des enregistrements
 * dont l'utilisateur detient la licence, et il n'y a aucune raison d'en
 * conserver une copie ailleurs.
 *
 * L'espace est distinct de celui des morceaux telecharges et de celui de la
 * banque d'echantillons : ces trois choses se gerent, et se vident, separement.
 */

const NAMESPACE = 'stemlab-pad-library'
const MANIFEST = 'manifest.json'

export interface PadEntry {
  readonly id: string
  /** Tonalite associee : `5-major`, `9-minor`. */
  readonly keyId: string
  readonly name: string
  readonly bytes: number
  readonly addedAt: number
}

interface Manifest {
  readonly version: 1
  readonly entries: readonly PadEntry[]
}

const EMPTY: Manifest = { version: 1, entries: [] }

/**
 * Plafond de la bibliotheque.
 *
 * Une nappe de trente secondes en WAV stereo pese une dizaine de megaoctets, et
 * il en faut vingt-quatre pour couvrir toutes les tonalites. Un demi-gigaoctet
 * laisse de la marge sans menacer le quota du navigateur.
 */
export const MAX_LIBRARY_BYTES = 512 * 1024 * 1024

export async function listPads(): Promise<readonly PadEntry[]> {
  return (await readManifest()).entries
}

/**
 * Range un fichier et devine sa tonalite d'apres son nom.
 *
 * La tonalite devinee n'engage a rien : elle est modifiable ensuite. Beaucoup de
 * bibliotheques la mettent dans le nom, et la deviner evite vingt-quatre
 * reglages manuels.
 */
export async function addPad(file: File): Promise<PadEntry> {
  const storage = await open()
  const manifest = await readManifest()

  const used = manifest.entries.reduce((total, entry) => total + entry.bytes, 0)
  if (used + file.size > MAX_LIBRARY_BYTES) {
    throw new Error(
      `La bibliotheque est pleine (${Math.round(MAX_LIBRARY_BYTES / 1e6)} Mo). ` +
        'Retirez une nappe avant d en ajouter une autre.',
    )
  }

  const devinee = parseKeyFromName(file.name)
  const entry: PadEntry = {
    id: crypto.randomUUID(),
    keyId: devinee ? keyId(devinee.root, devinee.mode) : '',
    name: file.name,
    bytes: file.size,
    addedAt: Date.now(),
  }

  await storage.write(fileName(entry.id), new Uint8Array(await file.arrayBuffer()))
  await writeManifest(storage, { ...manifest, entries: [...manifest.entries, entry] })
  return entry
}

export async function assignKey(id: string, key: string): Promise<void> {
  const storage = await open()
  const manifest = await readManifest()

  await writeManifest(storage, {
    ...manifest,
    entries: manifest.entries.map((entry) => (entry.id === id ? { ...entry, keyId: key } : entry)),
  })
}

export async function removePad(id: string): Promise<void> {
  const storage = await open()
  const manifest = await readManifest()

  await storage.remove(fileName(id))
  await writeManifest(storage, {
    ...manifest,
    entries: manifest.entries.filter((entry) => entry.id !== id),
  })
}

/** Octets d'une nappe, ou `null` quand le fichier a disparu. */
export async function readPad(id: string): Promise<Uint8Array | null> {
  const storage = await open()
  return storage.read(fileName(id))
}

export async function libraryBytes(): Promise<number> {
  return (await readManifest()).entries.reduce((total, entry) => total + entry.bytes, 0)
}

// --- interne ---------------------------------------------------------------

let storagePromise: Promise<OpfsStorage> | null = null

async function open(): Promise<OpfsStorage> {
  if (!OpfsStorage.isSupported()) {
    throw new Error("Ce navigateur ne sait pas conserver de fichiers hors connexion.")
  }
  storagePromise ??= OpfsStorage.open(NAMESPACE)
  return storagePromise
}

function fileName(id: string): string {
  return `pad-${id}.bin`
}

async function readManifest(): Promise<Manifest> {
  try {
    const storage = await open()
    const raw = await storage.read(MANIFEST)
    if (!raw) return EMPTY

    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw))
    const entries = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entries)) return EMPTY

    return { version: 1, entries: entries.filter(isEntry) }
  } catch {
    // Manifeste illisible ou stockage indisponible : repartir a vide vaut mieux
    // que de refuser l'acces a la page.
    return EMPTY
  }
}

async function writeManifest(storage: OpfsStorage, manifest: Manifest): Promise<void> {
  await storage.write(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest)))
}

function isEntry(value: unknown): value is PadEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.keyId === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.bytes === 'number' &&
    typeof entry.addedAt === 'number'
  )
}
