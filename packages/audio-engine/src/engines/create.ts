/*
 * La bibliotheque `signalsmith-stretch` ne fournit pas de declarations. Les notres
 * vivent dans `../signalsmith-stretch.d.ts`, et doivent voyager avec ce fichier :
 * une application qui consomme ce paquet en source n'inclut que les fichiers
 * atteints par ses imports, et une declaration ambiante ne l'est pas.
 *
 * C'est precisement ce a quoi sert une reference triple slash ; la regle qui la
 * decourage vise les imports de valeurs, pas ce cas.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../signalsmith-stretch.d.ts" />
import type { LoadedStem } from '../types.js'
import { BufferSourceEngine } from './buffer-engine.js'
import { StretchEngine } from './stretch-engine.js'
import type { PlaybackEngine } from './types.js'

/**
 * Choisit le moteur de restitution.
 *
 * L'etirement temporel est prefere : il dissocie tempo et hauteur. S'il ne peut pas
 * etre charge — AudioWorklet indisponible, politique de securite bloquant le
 * `Blob:` du module, WASM refuse — on retombe sur des sources classiques plutot que
 * de priver l'utilisateur de lecture. Le repli est signale par
 * `supportsIndependentPitch`, ce qui permet a l'interface de le dire.
 */
export interface CreateEngineOptions {
  /** Injectable pour les tests ; par defaut, la bibliotheque est chargee a la demande. */
  loadStretchFactory?: () => Promise<StretchFactory>
  onFallback?: (reason: Error) => void
}

type StretchFactory = Parameters<typeof StretchEngine.create>[2]

export async function createPlaybackEngine(
  context: BaseAudioContext,
  stems: readonly LoadedStem[],
  options: CreateEngineOptions = {},
): Promise<PlaybackEngine> {
  try {
    const factory = options.loadStretchFactory
      ? await options.loadStretchFactory()
      : await loadSignalsmith()
    return await StretchEngine.create(context, stems, factory)
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    options.onFallback?.(error)
    return new BufferSourceEngine(context, stems)
  }
}

/** Import differe : la bibliotheque ne pese sur le chargement que si on la sollicite. */
async function loadSignalsmith(): Promise<StretchFactory> {
  const { default: create } = await import('signalsmith-stretch')
  if (typeof create !== 'function') {
    throw new TypeError("signalsmith-stretch n'expose pas de fabrique")
  }
  return create
}
