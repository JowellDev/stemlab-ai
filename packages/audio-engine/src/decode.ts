import type { StemType } from '@stemlab/contracts'
import type { LoadProgress, LoadedStem, StemSource } from './types.js'

export class StemLoadError extends Error {
  readonly stemType: StemType

  constructor(stemType: StemType, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StemLoadError'
    this.stemType = stemType
  }
}

export interface LoadStemsOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: LoadProgress) => void
  /** Injectable pour les tests et pour servir depuis l'OPFS en phase 7. */
  readonly fetchImpl?: typeof fetch
}

/**
 * Charge et decode toutes les pistes en parallele.
 *
 * Les pistes sont decodees ensemble et non a la demande : un demarrage synchrone
 * exige que tous les `AudioBuffer` existent avant la planification. Le compromis est
 * assume — c'est le prix de la synchronisation a l'echantillon.
 */
export async function loadStems(
  context: BaseAudioContext,
  sources: readonly StemSource[],
  options: LoadStemsOptions = {},
): Promise<LoadedStem[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const total = sources.length
  let loaded = 0

  const results = await Promise.all(
    sources.map(async (source) => {
      const buffer = await loadOne(context, source, fetchImpl, options.signal)
      loaded += 1
      options.onProgress?.({ loaded, total, type: source.type })
      return { type: source.type, buffer }
    }),
  )

  // On restitue l'ordre d'entree : Promise.all le garantit deja, mais le rendre
  // explicite evite qu'une refonte en `for await` casse l'ordre des pistes a l'ecran.
  return results
}

async function loadOne(
  context: BaseAudioContext,
  source: StemSource,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<AudioBuffer> {
  let response: Response
  try {
    response = await fetchImpl(source.url, signal ? { signal } : {})
  } catch (cause) {
    throw new StemLoadError(source.type, `telechargement de la piste ${source.type} impossible`, {
      cause,
    })
  }

  if (!response.ok) {
    throw new StemLoadError(
      source.type,
      `telechargement de la piste ${source.type} : HTTP ${response.status}`,
    )
  }

  const encoded = await response.arrayBuffer()

  try {
    return await context.decodeAudioData(encoded)
  } catch (cause) {
    throw new StemLoadError(source.type, `decodage de la piste ${source.type} impossible`, {
      cause,
    })
  }
}
